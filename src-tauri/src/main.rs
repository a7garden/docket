// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 앱이 스스로를 한 번 더 띄워 맡긴 일(PDF 글자 뽑기)이면 창을 띄우지 않고 그 일만 하고 끝난다.
    if let Some(code) = docket_lib::child_task() {
        std::process::exit(code);
    }
    docket_lib::run()
}
