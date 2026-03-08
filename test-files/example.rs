use std::fmt;

/// A simple logger that writes to stderr.
///
/// This logger supports filtering log messages by level
/// and can optionally include timestamps.
///
/// # Examples
///
/// ```
/// use my_crate::Logger;
///
/// let logger = Logger::new();
/// logger.info("Hello, world!");
/// ```
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
}

/// Log severity levels, ordered from least to most severe.
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
