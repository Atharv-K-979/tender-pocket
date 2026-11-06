export function sleep(s) { const end = Date.now() + s * 1000; while (Date.now() < end) { /* busy */ } }
export function check() { return true; }
export default { sleep, check };
