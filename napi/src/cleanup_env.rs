pub(crate) struct CleanupEnvHookData<T: 'static> {
  pub(crate) data: T,
  pub(crate) hook: Box<dyn FnOnce(T)>,
}

#[derive(Clone, Copy)]
pub struct CleanupEnvHook<T: 'static>(pub(crate) *mut CleanupEnvHookData<T>);
