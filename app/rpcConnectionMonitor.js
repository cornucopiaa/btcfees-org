"use strict";

// Keep recovery independent of initial application setup: a later reconnect
// must not create duplicate data-refresh timers or rerun startup work.
module.exports = function createRpcConnectionMonitor(options) {
	let pending = null;
	return function verifyRpcConnection() {
		if (pending) return pending;
		pending = Promise.resolve().then(async () => {
			try {
				if (!options.isClientReady()) options.reconnect();
				const result = await options.probe();
				await options.onHealthy(result);
			} catch (error) {
				options.onUnhealthy();
				try {
					options.reconnect();
				} catch (reconnectError) {
					options.onError(reconnectError);
				}
				options.onError(error);
			}
		}).finally(() => {
			pending = null;
		});
		return pending;
	};
};
