const getTimestamp = () => new Date().toISOString();

const logger = {
  info: (message) => {
    console.log(`[${getTimestamp()}] [INFO]  ${message}`);
  },

  error: (message) => {
    console.error(`[${getTimestamp()}] [ERROR] ${message}`);
  },

  warn: (message) => {
    console.warn(`[${getTimestamp()}] [WARN]  ${message}`);
  },

  debug: (message) => {
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[${getTimestamp()}] [DEBUG] ${message}`);
    }
  },
};

export default logger;