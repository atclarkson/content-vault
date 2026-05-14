class Queue {
  constructor(concurrency = 3) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.queue = [];
    this.activeCount = 0;
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.runNext();
    });
  }

  get pending() {
    return this.queue.length;
  }

  get running() {
    return this.activeCount;
  }

  runNext() {
    if (this.activeCount >= this.concurrency) {
      return;
    }

    const job = this.queue.shift();

    if (!job) {
      return;
    }

    this.activeCount += 1;

    Promise.resolve()
      .then(() => job.fn())
      .then((result) => {
        job.resolve(result);
      })
      .catch((error) => {
        job.reject(error);
      })
      .finally(() => {
        this.activeCount -= 1;
        this.runNext();
      });
  }
}

module.exports = {
  Queue,
  defaultQueue: new Queue(3)
};
