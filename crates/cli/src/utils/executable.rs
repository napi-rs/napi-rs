pub type CommandResult = Result<(), ()>;

pub trait Executable {
  fn execute(&mut self) -> CommandResult;
}
