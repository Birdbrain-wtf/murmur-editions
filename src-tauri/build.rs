fn main() {
    // Private messages: the relay address with its queue password, injected by the
    // release scripts (src/simplex.rs). Rebuild when it changes.
    println!("cargo:rerun-if-env-changed=MURMUR_SMP_RELAY");
    tauri_build::build()
}
