const createAsyncMutex = () => {
  let tail = Promise.resolve();
  return {
    async run(operation) {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
};

const audioCaptureMutex = createAsyncMutex();

module.exports = { audioCaptureMutex, createAsyncMutex };
