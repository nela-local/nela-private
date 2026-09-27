//! Spreadsheet artifact rendering (XLSX).

mod write;
pub mod xlsx_python;

pub use write::write_spreadsheet_plan;
pub use xlsx_python::{
    preflight_xlsx_python_code, run_xlsx_python_script, save_xlsx_bytes, XlsxPythonResult,
};
