// Snapshot based undo/redo. Snapshots are JSON strings of the design state.
export class History {
  constructor(limit = 150) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
  }

  reset(snapshot) {
    this.stack = [snapshot];
    this.index = 0;
  }

  push(snapshot) {
    if (this.stack[this.index] === snapshot) return false;
    this.stack.length = this.index + 1;
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.stack.length - 1;
  }

  undo() {
    if (!this.canUndo) return null;
    return this.stack[--this.index];
  }

  redo() {
    if (!this.canRedo) return null;
    return this.stack[++this.index];
  }
}
