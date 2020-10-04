pub(crate) struct CleanupEnvHookData<T: 'static> {
  pub(crate) data: T,
  pub(crate) hook: Box<dyn FnOnce(T) -> ()>,
}

#[repr(transparent)]
#[derive(Debug, Clone, Copy)]
pub struct CleanupEnvHook<T: 'static>(pub(crate) *mut CleanupEnvHookData<T>);
