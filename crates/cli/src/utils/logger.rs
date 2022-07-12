pub use log::*;

pub struct SimpleLogger;

impl Log for SimpleLogger {
  fn enabled(&self, metadata: &Metadata) -> bool {
    metadata.level() <= max_level()
  }

  fn log(&self, record: &Record) {
    if self.enabled(record.metadata()) && record.level() > Level::Info {
      println!("[{}] {}", record.level(), record.args());
    }
  }

  fn flush(&self) {}
}
