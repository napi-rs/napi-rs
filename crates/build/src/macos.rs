pub fn setup() {
  println!("cargo:rustc-link-arg=-Wl");
  println!("cargo:rustc-link-arg=-undefined");
  println!("cargo:rustc-link-arg=dynamic_lookup");
}
