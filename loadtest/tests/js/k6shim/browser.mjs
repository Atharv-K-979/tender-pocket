export const browser = { newContext() { throw new Error('browser not available in node shim'); } };
