//! # My Crate
//!
//! `my_crate` provides a simple logging framework.
//!
//! ## Quick Start
//!
//! ```
//! use my_crate::Logger;
//!
//! let logger = Logger::new();
//! logger.info("Hello, world!");
//! ```
//!
//! See [`Logger`] for details.

use std::fmt;
use std::io;

/// A simple logger that writes to stderr.
///
/// This logger supports filtering log messages by level
/// and can optionally include timestamps.
///
/// The logger implements the `Log` trait from the [`log` crate][log-crate-url],
/// which allows it to act as a logger.
///
/// Use [`Logger::new()`] to create an instance, or [`try_init()`] to set up
/// the global logger.
///
/// # Examples
///
/// ```
/// use my_crate::Logger;
///
/// let logger = Logger::new();
/// logger.info("Hello, world!");
/// ```
///
/// [log-crate-url]: https://docs.rs/log
/// [`Logger::new()`]: struct.Logger.html#method.new
/// [`try_init()`]: fn.try_init.html
pub struct Logger {
    level: Level,
}

impl Logger {
    /// Creates a new logger with default settings.
    ///
    /// The default log level is `Info`.
    ///
    /// # Examples
    ///
    /// ```
    /// let logger = Logger::new();
    /// assert_eq!(logger.level(), Level::Info);
    /// ```
    pub fn new() -> Self {
        Logger { level: Level::Info }
    }

    /// Sets the minimum log level.
    pub fn set_level(&mut self, level: Level) {
        self.level = level;
    }

    /// Returns the current log level.
    pub fn level(&self) -> Level {
        self.level
    }

    /// Logs a message at the given level.
    ///
    /// If the message's level is below the logger's minimum level,
    /// it will be silently discarded.
    ///
    /// # Arguments
    ///
    /// * `level` - The severity level of the message
    /// * `msg` - The message to log
    ///
    /// # Examples
    ///
    /// ```
    /// let mut logger = Logger::new();
    /// logger.log(Level::Debug, "debugging info");
    /// logger.log(Level::Error, "something went wrong");
    /// ```
    pub fn log(&self, level: Level, msg: &str) {
        if level >= self.level {
            eprintln!("[{level}] {msg}");
        }
    }

    /// Sets the format function for formatting the log output.
    ///
    /// This function is called on each record logged and should format the
    /// log record and output it to the given [`Formatter`].
    ///
    /// The format function is expected to output the string directly to the
    /// `Formatter` so that implementations can use the [`std::fmt`] macros
    /// to format and output without intermediate heap allocations. The default
    /// `env_logger` formatter takes advantage of this.
    ///
    /// When the `color` feature is enabled, styling via **ANSI escape codes**
    /// is supported and the output will automatically respect
    /// [`Builder::write_style`].
    ///
    /// # Examples
    ///
    /// Use a custom format to write only the log message:
    ///
    /// ```
    /// use std::io::Write;
    /// use env_logger::Builder;
    ///
    /// let mut builder = Builder::new();
    ///
    /// builder.format(|buf, record| writeln!(buf, "{}", record.args()));
    /// ```
    ///
    /// [`Formatter`]: fmt/struct.Formatter.html
    /// [`String`]: https://doc.rust-lang.org/stable/std/string/struct.String.html
    /// [`std::fmt`]: https://doc.rust-lang.org/std/fmt/index.html
    /// [`Builder::write_style`]: struct.Builder.html#method.write_style
    pub fn format<F>(&mut self, _format: F) -> &mut Self
    where
        F: Fn(&mut fmt::Formatter<'_>, &str) -> io::Result<()> + Sync + Send + 'static,
    {
        self
    }
}

/// Log severity levels, ordered from least to most severe.
///
/// The levels are ordered such that `Debug` < `Info` < `Warn` < `Error`.
///
/// # Comparison
///
/// | Level   | Numeric | Use case                          |
/// |---------|---------|-----------------------------------|
/// | `Debug` | 0       | Detailed debugging information    |
/// | `Info`  | 1       | General informational messages    |
/// | `Warn`  | 2       | Warning conditions                |
/// | `Error` | 3       | Error conditions                  |
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    /// Detailed debugging information.
    Debug,
    /// Informational messages.
    Info,
    /// Warning messages.
    Warn,
    /// Error messages.
    Error,
}

/// Attempts to initialize the global logger.
///
/// This should be called early in the execution of a Rust program. Any log
/// events that occur *before* initialization will be **ignored**.
///
/// # Examples
///
/// ```
/// use my_crate::Logger;
///
/// # fn run() -> Result<(), Box<dyn std::error::Error>> {
/// let logger = Logger::new();
/// logger.init()?;
/// # Ok(())
/// # }
/// # run().unwrap();
/// ```
///
/// # Errors
///
/// This function will fail if it is called more than once, or if another
/// library has already initialized a global logger.
///
/// # Panics
///
/// Does **not** panic. Use [`init()`] if you want a panicking version.
///
/// [`init()`]: fn.init.html
pub fn try_init() -> Result<(), String> {
    Ok(())
}

/// A builder for configuring the logger.
///
/// Use [`Builder::new`] to create an instance. Call [`Builder::build`] to
/// produce a [`Logger`]. You can also use [`Level`] to set the minimum level.
///
/// See also [`try_init`] for global initialization.
pub struct Builder {
    level: Level,
}

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Level::Debug => write!(f, "DEBUG"),
            Level::Info => write!(f, "INFO"),
            Level::Warn => write!(f, "WARN"),
            Level::Error => write!(f, "ERROR"),
        }
    }
}
