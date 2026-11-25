use std::{
  collections::HashMap,
  sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc, LazyLock, Mutex,
  },
};

use napi::{bindgen_prelude::*, PropertyAttributes, Task};
use tokio::sync::Notify;

static DROP_COUNTS: LazyLock<Mutex<HashMap<u32, u32>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));
static FINALIZE_COUNTS: LazyLock<Mutex<HashMap<u32, u32>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));
static SHARED_VIEW_DROP_COUNTS: LazyLock<Mutex<HashMap<u32, u32>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));
static SHARED_VIEW_DROP_OBSERVATIONS: LazyLock<Mutex<HashMap<u32, (u32, u32)>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));
static ZST_DROP_COUNT: AtomicU32 = AtomicU32::new(0);
static ALIGNED_ZST_DROP_COUNT: AtomicU32 = AtomicU32::new(0);

fn record_drop(id: u32) {
  let mut map = DROP_COUNTS.lock().unwrap();
  *map.entry(id).or_insert(0) += 1;
}

fn record_finalize(id: u32) {
  let mut map = FINALIZE_COUNTS.lock().unwrap();
  *map.entry(id).or_insert(0) += 1;
}

fn record_shared_view_drop(id: u32, observed_value: u32, parent_drops_at_view_drop: u32) {
  let mut map = SHARED_VIEW_DROP_COUNTS.lock().unwrap();
  *map.entry(id).or_insert(0) += 1;
  SHARED_VIEW_DROP_OBSERVATIONS
    .lock()
    .unwrap()
    .insert(id, (observed_value, parent_drops_at_view_drop));
}

#[napi]
pub fn get_disposable_drop_count(id: u32) -> u32 {
  DROP_COUNTS.lock().unwrap().get(&id).copied().unwrap_or(0)
}

#[napi]
pub fn get_disposable_finalize_count(id: u32) -> u32 {
  FINALIZE_COUNTS
    .lock()
    .unwrap()
    .get(&id)
    .copied()
    .unwrap_or(0)
}

#[napi]
pub fn get_disposable_shared_view_drop_count(id: u32) -> u32 {
  SHARED_VIEW_DROP_COUNTS
    .lock()
    .unwrap()
    .get(&id)
    .copied()
    .unwrap_or(0)
}

#[napi]
pub fn get_disposable_shared_view_drop_observation(id: u32) -> Option<Vec<u32>> {
  SHARED_VIEW_DROP_OBSERVATIONS
    .lock()
    .unwrap()
    .get(&id)
    .map(|&(val, parent_drops)| vec![val, parent_drops])
}

#[napi]
pub fn get_disposable_zst_drop_count() -> u32 {
  ZST_DROP_COUNT.load(Ordering::SeqCst)
}

#[napi]
pub fn get_disposable_aligned_zst_drop_count() -> u32 {
  ALIGNED_ZST_DROP_COUNT.load(Ordering::SeqCst)
}

// Async gate backed by `tokio::sync::Notify` so `async fn` tests can pause
// deterministically without blocking a worker thread.
struct AsyncGate {
  entered: AtomicBool,
  entered_notify: Notify,
  released: AtomicBool,
  release_notify: Notify,
}

impl AsyncGate {
  fn new() -> Self {
    Self {
      entered: AtomicBool::new(false),
      entered_notify: Notify::new(),
      released: AtomicBool::new(false),
      release_notify: Notify::new(),
    }
  }
}

static ASYNC_GATES: LazyLock<Mutex<HashMap<u32, Arc<AsyncGate>>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

#[napi]
pub fn open_disposable_async_gate(gate_id: u32) {
  ASYNC_GATES
    .lock()
    .unwrap()
    .insert(gate_id, Arc::new(AsyncGate::new()));
}

#[napi]
pub fn release_disposable_async_gate(gate_id: u32) {
  if let Some(gate) = ASYNC_GATES.lock().unwrap().get(&gate_id).cloned() {
    gate.released.store(true, Ordering::SeqCst);
    gate.release_notify.notify_waiters();
  }
}

#[napi]
pub async fn wait_disposable_async_gate_entered(gate_id: u32) -> Result<()> {
  let gate = ASYNC_GATES
    .lock()
    .unwrap()
    .get(&gate_id)
    .cloned()
    .ok_or_else(|| Error::new(Status::InvalidArg, format!("unknown async gate {gate_id}")))?;
  while !gate.entered.load(Ordering::SeqCst) {
    let notified = gate.entered_notify.notified();
    if gate.entered.load(Ordering::SeqCst) {
      break;
    }
    notified.await;
  }
  Ok(())
}

/// Custom return value whose `ToNapiValue` invokes a JS callback while the
/// method's `DeferredNativeBorrowScopeGuard` is still active.
pub struct DisposableReturnHook {
  cb: Function<'static, (), Unknown<'static>>,
  value: u32,
}

impl ToNapiValue for DisposableReturnHook {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    val.cb.call(())?;
    unsafe { u32::to_napi_value(env, val.value) }
  }
}

/// Field value whose `&mut DisposableFieldHookValue: ToNapiValue` invokes a JS
/// callback while the default field getter holds `acquire_native_borrow_with_env`.
pub struct DisposableFieldHookValue {
  cb: Option<FunctionRef<(), ()>>,
  value: u32,
}

impl ToNapiValue for &mut DisposableFieldHookValue {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    if let Some(cb) = val.cb.as_ref() {
      let env_wrapper = Env::from_raw(env);
      let func = cb.borrow_back(&env_wrapper)?;
      func.call(())?;
    }
    unsafe { u32::to_napi_value(env, val.value) }
  }
}

#[napi(disposable)]
pub struct DisposableFieldHook {
  id: u32,
  #[napi(readonly, ts_type = "number")]
  pub hook_value: DisposableFieldHookValue,
}

impl Drop for DisposableFieldHook {
  fn drop(&mut self) {
    record_drop(self.id);
  }
}

#[napi]
impl DisposableFieldHook {
  #[napi(constructor)]
  pub fn new(id: u32, value: u32, cb: Function<(), ()>) -> Result<Self> {
    Ok(Self {
      id,
      hook_value: DisposableFieldHookValue {
        cb: Some(cb.create_ref()?),
        value,
      },
    })
  }
}

#[napi(object)]
pub struct DisposableSetterPayload {
  pub next_value: u32,
}

#[napi(disposable)]
pub struct DisposableResource {
  id: u32,
  pub value: u32,
  tag: String,
  payload: Vec<u8>,
}

impl Drop for DisposableResource {
  fn drop(&mut self) {
    record_drop(self.id);
  }
}

pub struct DisposableReadTask<'a> {
  res: &'a DisposableResource,
  gate: u32,
}

#[napi]
impl<'task> Task for DisposableReadTask<'task> {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    crate::issue_3583::wait_borrow_gate(self.gate)?;
    Ok(self.res.value.wrapping_add(self.res.payload.len() as u32))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

pub struct DisposableSharedView<'a> {
  id: u32,
  res: &'a DisposableResource,
}

impl Drop for DisposableSharedView<'_> {
  fn drop(&mut self) {
    // Prove `T` is still alive (not yet dropped) when the `SharedReference`
    // child view `S` runs its `Drop` impl during `finalize_class_instance`.
    let parent_drops = get_disposable_drop_count(self.id);
    let observed_value = self.res.value;
    debug_assert_eq!(self.res.tag, format!("res-{}", self.id));
    record_shared_view_drop(self.id, observed_value, parent_drops);
  }
}

#[napi]
pub struct DisposableRefHolder {
  inner: Option<Reference<DisposableResource>>,
}

#[napi]
impl DisposableRefHolder {
  #[napi]
  pub fn read(&self) -> Result<u32> {
    let inner = self
      .inner
      .as_ref()
      .ok_or_else(|| Error::new(Status::GenericFailure, "Reference already released"))?;
    Ok(inner.value)
  }

  #[napi]
  pub fn clone_ref(&self, env: Env) -> Result<DisposableRefHolder> {
    let inner = self
      .inner
      .as_ref()
      .ok_or_else(|| Error::new(Status::GenericFailure, "Reference already released"))?;
    Ok(DisposableRefHolder {
      inner: Some(inner.clone(env)?),
    })
  }

  #[napi]
  pub fn release(&mut self) {
    self.inner.take();
  }
}

#[napi]
pub struct DisposableWeakHolder {
  inner: WeakReference<DisposableResource>,
}

#[napi]
impl DisposableWeakHolder {
  #[napi]
  pub fn is_alive(&self) -> bool {
    self.inner.get().is_some()
  }

  #[napi]
  pub fn try_get_value(&self) -> Option<u32> {
    self.inner.get().map(|r| r.value)
  }

  #[napi]
  pub fn try_upgrade(&self, env: Env) -> Result<bool> {
    Ok(self.inner.upgrade(env)?.is_some())
  }

  #[napi]
  pub fn try_to_js(&self) -> WeakReference<DisposableResource> {
    self.inner.clone()
  }
}

#[napi]
pub struct DisposableSharedHolder {
  inner: Option<SharedReference<DisposableResource, DisposableSharedView<'static>>>,
}

#[napi]
impl DisposableSharedHolder {
  #[napi]
  pub fn read(&self) -> Result<u32> {
    let inner = self
      .inner
      .as_ref()
      .ok_or_else(|| Error::new(Status::GenericFailure, "SharedReference already released"))?;
    Ok(inner.res.value)
  }

  #[napi]
  pub fn release(&mut self) {
    self.inner.take();
  }
}

#[napi]
impl DisposableResource {
  #[napi(constructor)]
  pub fn new(id: u32, value: u32, payload_size: Option<u32>) -> Self {
    let size = payload_size.unwrap_or(0) as usize;
    Self {
      id,
      value,
      tag: format!("res-{id}"),
      payload: vec![0x42u8; size],
    }
  }

  #[napi(factory)]
  pub fn create(id: u32, value: u32) -> Self {
    Self {
      id,
      value,
      tag: format!("factory-{id}"),
      payload: Vec::new(),
    }
  }

  /// Static `[Symbol.dispose]` lives on the constructor, so it does not conflict
  /// with `#[napi(disposable)]`'s prototype `[Symbol.dispose]`.
  #[napi(well_known_symbol = "dispose")]
  pub fn static_dispose() -> u32 {
    777
  }

  #[napi]
  pub fn read(&self) -> u32 {
    self.value
  }

  #[napi]
  pub fn payload_len(&self) -> u32 {
    self.payload.len() as u32
  }

  #[napi]
  pub fn increment(&mut self, delta: u32) -> u32 {
    self.value += delta;
    self.value
  }

  #[napi(getter)]
  pub fn tag(&self) -> String {
    self.tag.clone()
  }

  #[napi(setter)]
  pub fn set_tag(&mut self, tag: String) {
    self.tag = tag;
  }

  #[napi(setter)]
  pub fn set_payload_value(&mut self, payload: DisposableSetterPayload) {
    self.value = payload.next_value;
  }

  #[napi]
  pub fn read_via_this_ref(this: This<&DisposableResource>) -> u32 {
    this.value
  }

  #[napi]
  pub fn bump_via_this_mut(mut this: This<&mut DisposableResource>, delta: u32) -> u32 {
    this.value += delta;
    this.value
  }

  #[napi]
  pub fn read_via_reference(&self, reference: Reference<DisposableResource>) -> u32 {
    reference.value
  }

  #[napi]
  pub fn with_ref_and_holder(
    &self,
    reference: Reference<DisposableResource>,
    cb: Function<DisposableRefHolder, ()>,
  ) -> Result<u32> {
    let holder = DisposableRefHolder {
      inner: Some(reference),
    };
    cb.call(holder)?;
    Ok(self.value)
  }

  #[napi]
  pub fn with_callback(&self, cb: Function<(), ()>) -> Result<u32> {
    cb.call(())?;
    // Must still be valid even if `cb` called `this[Symbol.dispose]()`.
    Ok(self.value)
  }

  #[napi]
  pub fn with_mut_callback(&mut self, cb: Function<(), ()>) -> Result<u32> {
    cb.call(())?;
    self.value += 10;
    Ok(self.value)
  }

  #[napi(ts_return_type = "number")]
  pub fn read_with_return_hook(
    &self,
    cb: Function<'static, (), Unknown<'static>>,
  ) -> DisposableReturnHook {
    DisposableReturnHook {
      cb,
      value: self.value,
    }
  }

  #[napi]
  pub async fn read_async_gated(&self, gate_id: u32) -> Result<u32> {
    let gate = ASYNC_GATES
      .lock()
      .unwrap()
      .get(&gate_id)
      .cloned()
      .ok_or_else(|| Error::new(Status::InvalidArg, format!("unknown async gate {gate_id}")))?;
    gate.entered.store(true, Ordering::SeqCst);
    gate.entered_notify.notify_waiters();
    while !gate.released.load(Ordering::SeqCst) {
      let notified = gate.release_notify.notified();
      if gate.released.load(Ordering::SeqCst) {
        break;
      }
      notified.await;
    }
    Ok(self.value.wrapping_add(self.payload.len() as u32))
  }

  #[napi]
  pub fn read_in_async_task<'a>(&'a self, gate: u32) -> AsyncTask<DisposableReadTask<'a>> {
    AsyncTask::new(DisposableReadTask { res: self, gate })
  }

  #[napi]
  pub fn create_ref_holder(&self, reference: Reference<DisposableResource>) -> DisposableRefHolder {
    DisposableRefHolder {
      inner: Some(reference),
    }
  }

  #[napi]
  pub fn create_weak_holder(
    &self,
    reference: Reference<DisposableResource>,
  ) -> DisposableWeakHolder {
    DisposableWeakHolder {
      inner: reference.downgrade(),
    }
  }

  #[napi]
  pub fn create_shared_holder(
    &self,
    reference: Reference<DisposableResource>,
    env: Env,
  ) -> Result<DisposableSharedHolder> {
    let id = self.id;
    let shared = reference.share_with(env, move |res| Ok(DisposableSharedView { id, res }))?;
    Ok(DisposableSharedHolder {
      inner: Some(shared),
    })
  }
}

#[napi]
pub fn create_disposable_by_value(id: u32, value: u32) -> DisposableResource {
  DisposableResource {
    id,
    value,
    tag: format!("by-value-{id}"),
    payload: Vec::new(),
  }
}

#[napi]
pub fn read_disposable_ref(res: &DisposableResource) -> u32 {
  res.value
}

#[napi(strict)]
pub fn read_disposable_ref_strict(res: &DisposableResource) -> u32 {
  res.value
}

#[napi]
pub fn bump_disposable_mut_ref(res: &mut DisposableResource, delta: u32) -> u32 {
  res.value += delta;
  res.value
}

#[napi]
pub fn read_disposable_instance(inst: ClassInstance<DisposableResource>) -> u32 {
  (*inst).value
}

#[napi]
pub fn with_disposable_instance_callback(
  inst: ClassInstance<DisposableResource>,
  cb: Function<(), ()>,
) -> Result<u32> {
  cb.call(())?;
  Ok((*inst).value)
}

#[napi]
pub fn read_disposable_instance_from_object_property(obj: Object) -> Result<u32> {
  let inst: ClassInstance<DisposableResource> = obj.get_named_property("res")?;
  Ok((*inst).value)
}

#[napi]
pub fn into_instance_disposed_in_callback(
  env: &Env,
  id: u32,
  value: u32,
  cb: Function<Object, ()>,
) -> Result<u32> {
  let inst = DisposableResource::new(id, value, None).into_instance(env)?;
  cb.call(inst.as_object(env))?;
  Ok((*inst).value)
}

#[napi(disposable, constructor)]
pub struct DisposableDefaultCtor {
  pub id: u32,
  pub count: u32,
}

impl Drop for DisposableDefaultCtor {
  fn drop(&mut self) {
    record_drop(self.id);
  }
}

#[napi(disposable, custom_finalize)]
pub struct DisposableCustomFinalize {
  id: u32,
  value: u32,
  fail_on_finalize: bool,
}

impl Drop for DisposableCustomFinalize {
  fn drop(&mut self) {
    record_drop(self.id);
  }
}

impl ObjectFinalize for DisposableCustomFinalize {
  fn finalize(self, _env: Env) -> Result<()> {
    record_finalize(self.id);
    if self.fail_on_finalize {
      return Err(Error::new(
        Status::GenericFailure,
        format!("custom finalize failed for {}", self.id),
      ));
    }
    Ok(())
  }
}

#[napi]
impl DisposableCustomFinalize {
  #[napi(constructor)]
  pub fn new(id: u32, value: u32, fail_on_finalize: bool) -> Self {
    Self {
      id,
      value,
      fail_on_finalize,
    }
  }

  #[napi]
  pub fn read(&self) -> u32 {
    self.value
  }

  #[napi]
  pub fn with_callback(&self, cb: Function<(), ()>, return_err: bool) -> Result<u32> {
    cb.call(())?;
    if return_err {
      return Err(Error::new(
        Status::GenericFailure,
        format!("method failed for {}", self.id),
      ));
    }
    Ok(self.value)
  }
}

#[napi(disposable)]
pub struct DisposableZst;

impl Drop for DisposableZst {
  fn drop(&mut self) {
    ZST_DROP_COUNT.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
impl DisposableZst {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self
  }

  #[napi(factory)]
  pub fn create() -> Self {
    Self
  }

  #[napi]
  pub fn ping(&self) -> u32 {
    42
  }
}

#[napi]
pub fn create_disposable_zst() -> DisposableZst {
  DisposableZst
}

#[repr(align(16))]
#[napi(disposable)]
pub struct DisposableAlignedZst;

impl Drop for DisposableAlignedZst {
  fn drop(&mut self) {
    ALIGNED_ZST_DROP_COUNT.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
impl DisposableAlignedZst {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self
  }

  #[napi(factory)]
  pub fn create() -> Self {
    Self
  }

  #[napi]
  pub fn ping(&self) -> u32 {
    16
  }
}

#[napi]
pub fn create_disposable_aligned_zst() -> DisposableAlignedZst {
  DisposableAlignedZst
}

#[napi(disposable)]
pub struct DisposableWithLifetime<'a> {
  id: u32,
  inner: ClassInstance<'a, DisposableNonDisposable>,
}

impl Drop for DisposableWithLifetime<'_> {
  fn drop(&mut self) {
    record_drop(self.id);
  }
}

#[napi]
impl<'scope> DisposableWithLifetime<'scope> {
  #[napi(constructor)]
  pub fn new(
    id: u32,
    inner_id: u32,
    value: u32,
    env: &Env,
    mut this: This<'scope>,
  ) -> Result<Self> {
    let instance = DisposableNonDisposable {
      id: inner_id,
      value,
    }
    .into_instance(env)?;
    let inner = instance.assign_to_this("inner", &mut this)?;
    Ok(Self { id, inner })
  }

  #[napi]
  pub fn read_inner(&self) -> u32 {
    (*self.inner).value
  }
}

#[napi(disposable, js_name = "RenamedDisposable")]
pub struct DisposableCustomJsName {
  id: u32,
  pub value: u32,
}

impl Drop for DisposableCustomJsName {
  fn drop(&mut self) {
    record_drop(self.id);
  }
}

#[napi]
impl DisposableCustomJsName {
  #[napi(constructor)]
  pub fn new(id: u32, value: u32) -> Self {
    Self { id, value }
  }

  #[napi]
  pub fn read(&self) -> u32 {
    self.value
  }
}

#[napi(disposable)]
pub struct DisposableSibling {
  id: u32,
  pub value: u32,
}

impl Drop for DisposableSibling {
  fn drop(&mut self) {
    record_drop(self.id);
  }
}

#[napi]
impl DisposableSibling {
  #[napi(constructor)]
  pub fn new(id: u32, value: u32) -> Self {
    Self { id, value }
  }

  #[napi]
  pub fn read(&self) -> u32 {
    self.value
  }
}

#[napi]
pub struct DisposableNonDisposable {
  id: u32,
  pub value: u32,
}

impl Drop for DisposableNonDisposable {
  fn drop(&mut self) {
    record_drop(self.id);
  }
}

#[napi]
impl DisposableNonDisposable {
  #[napi(constructor)]
  pub fn new(id: u32, value: u32) -> Self {
    Self { id, value }
  }

  #[napi]
  pub fn read(&self) -> u32 {
    self.value
  }

  #[napi]
  pub fn try_assign_disposable_to_this(&self, env: &Env, mut this: This, id: u32) -> Result<()> {
    let inst = DisposableResource::new(id, 1, None).into_instance(env)?;
    let _ = inst.assign_to_this("inner", &mut this)?;
    Ok(())
  }

  #[napi]
  pub fn try_assign_disposable_to_this_with_attributes(
    &self,
    env: &Env,
    mut this: This,
    id: u32,
  ) -> Result<()> {
    let inst = DisposableResource::new(id, 1, None).into_instance(env)?;
    let _ = inst.assign_to_this_with_attributes("inner", PropertyAttributes::Default, &mut this)?;
    Ok(())
  }
}
