export default { test: { abort(msg) { globalThis.__ABORTED = msg; throw new Error(`ABORT ${msg}`); } }, vu: { idInTest: 1 } };
