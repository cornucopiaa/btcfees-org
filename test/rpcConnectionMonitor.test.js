"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const createMonitor = require("../app/rpcConnectionMonitor");
function fixture() {
	const state = { ready: true, healthy: false, reconnects: 0, probes: 0, initializations: 0, errors: [] };
	const options = {
		isClientReady: () => state.ready,
		reconnect: () => { state.ready = true; state.reconnects++; },
		probe: async () => { state.probes++; return { blocks: 123 }; },
		onHealthy: () => { if (!state.initialized) { state.initialized = true; state.initializations++; } state.healthy = true; },
		onUnhealthy: () => { state.healthy = false; },
		onError: error => state.errors.push(error),
	};
	return { state, options };
}
test("missing RPC client is recreated before the health probe", async () => {
	const {state, options} = fixture(); state.ready = false;
	await createMonitor(options)();
	assert.equal(state.reconnects, 1); assert.equal(state.probes, 1); assert.equal(state.healthy, true);
});
test("RPC outage after startup recovers without repeating initialization", async () => {
	const {state, options} = fixture(); const originalProbe = options.probe;
	options.probe = () => state.fail ? Promise.reject(new Error("offline")) : originalProbe();
	const verify = createMonitor(options); await verify();
	state.fail = true; await verify();
	assert.equal(state.healthy, false); assert.equal(state.reconnects, 1);
	state.fail = false; await verify();
	assert.equal(state.healthy, true); assert.equal(state.initializations, 1); assert.equal(state.errors.length, 1);
});
test("overlapping timer ticks share one probe", async () => {
	const {state, options} = fixture(); let release;
	options.probe = () => { state.probes++; return new Promise(resolve => { release = resolve; }); };
	const verify = createMonitor(options); const first = verify(); const second = verify();
	assert.equal(first, second); await Promise.resolve(); assert.equal(state.probes, 1);
	release({blocks:123}); await first;
});
test("a failed reconnect does not disable subsequent retries", async () => {
	const {state, options} = fixture(); state.ready = false; let fail = true;
	options.reconnect = () => { state.reconnects++; if (fail) throw new Error("credentials temporarily unavailable"); state.ready = true; };
	const verify = createMonitor(options); await verify(); assert.equal(state.healthy, false);
	fail = false; await verify(); assert.equal(state.healthy, true); assert.equal(state.probes, 1);
});
test("healthy periodic checks continue without reconnecting", async () => {
	const {state, options} = fixture(); const verify = createMonitor(options);
	await verify(); await verify(); assert.equal(state.probes, 2); assert.equal(state.reconnects, 0); assert.equal(state.initializations, 1);
});
