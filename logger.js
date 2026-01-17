const fsSync = require('fs');

// Logging utility
class Logger {
  constructor(logFile) {
    this.logFile = logFile;
    this.logStream = null;
  }

  initialize() {
    try {
      // Open log file in append mode if logFile is provided
      if (this.logFile) {
        this.logStream = fsSync.createWriteStream(this.logFile, { flags: 'a' });
      }
      this.log('=== Migration started ===');
    } catch (error) {
      // Fallback to console if file logging fails
      console.error('Failed to initialize log file:', error.message);
    }
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  log(message) {
    const timestamp = this.getTimestamp();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    // Always output to console
    console.log(message);
    
    try {
      if (this.logStream) {
        this.logStream.write(logMessage);
      }
    } catch (error) {
      // Fallback to console on error
      console.error('Logging error:', error.message);
    }
  }

  error(message, error = null) {
    const errorMessage = error ? `${message}: ${error.message || error}` : message;
    const fullErrorMessage = `ERROR: ${errorMessage}`;
    // Use console.error for errors, then log to file
    console.error(fullErrorMessage);
    const timestamp = this.getTimestamp();
    const logMessage = `[${timestamp}] ${fullErrorMessage}\n`;
    try {
      if (this.logStream) {
        this.logStream.write(logMessage);
      }
    } catch (err) {
      // Ignore logging errors
    }
  }

  close() {
    try {
      if (this.logStream) {
        this.log('=== Migration ended ===\n');
        this.logStream.end();
      }
    } catch (error) {
      console.error('Error closing log file:', error.message);
    }
  }
}

module.exports = Logger;

