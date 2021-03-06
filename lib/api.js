/* eslint-env node, browser */
'use strict';

var Replicant = require('./replicant');
var io = {};
var server = require('./server');
var filteredConfig = require('./config').filteredConfig;
var utils = require('./util');
var replicator = require('./replicator');

/**
 * Creates a new NodeCG API instance. It should never be necessary to use this constructor in a bundle,
 * as NodeCG automatically injects a pre-made API instance.
 * @constructor
 * @param {object} bundle - The bundle object to build an API instance from.
 */
function NodeCG(bundle, socket) {
	var self = this;

	// Make bundle name and config publicly accessible
	this.bundleName = bundle.name;

	/**
	 * An object containing the parsed content of `cfg/<bundle-name>.json`, the contents of which
	 * are read once when NodeCG starts up. Used to quickly access per-bundle configuration properties.
	 * @property {Object}
	 * @name NodeCG#bundleConfig
	 */
	this.bundleConfig = bundle.config;

	/**
	 * Provides access to NodeCG's logger, with the following methods. The logging level is set in `cfg/nodecg.json`,
	 * NodeCG's global config file.
	 * ```
	 * nodecg.log.trace('trace level logging');
	 * nodecg.log.debug('debug level logging');
	 * nodecg.log.info('info level logging');
	 * nodecg.log.warn('warn level logging');
	 * nodecg.log.error('error level logging');
	 * ```
	 * @function {Object}
	 * @name NodeCG#log
	 */
	this.log = require('./logger')(bundle.name);

	this._messageHandlers = [];

	if (process.env.browser) {
		// This constructor only works if socket.io is loaded
		if (typeof io === 'undefined') {
			throw new Error('[nodeceg] Socket.IO must be loaded before instantiating the API');
		}

		// If title isn't set, set it to the bundle name
		document.addEventListener('DOMContentLoaded', function () {
			if (document.title === '') {
				document.title = self.bundleName;
			}
		}, false);

		// Make socket accessible to public methods
		this.socket = socket;
		this.socket.emit('joinRoom', bundle.name);

		// Upon receiving a message, execute any handlers for it
		socket.on('message', function onMessage(data) {
			self.log.trace('Received message %s (sent to bundle %s) with data:',
				data.messageName, data.bundleName, data.content);

			self._messageHandlers.forEach(function (handler) {
				if (data.messageName === handler.messageName &&
					data.bundleName === handler.bundleName) {
					handler.func(data.content);
				}
			});
		});

		socket.on('error', function (err) {
			if (err.type === 'UnauthorizedError') {
				var url = [location.protocol, '//', location.host, location.pathname].join('');
				window.location.href = '/authError?code=' + err.code + '&message=' + err.message + '&viewUrl=' + url;
			} else {
				self.log.error('Unhandled socket error:', err);
			}
		});
	} else {
		io = server.getIO();

		io.on('connection', function onConnection(socket) {
			socket.setMaxListeners(64); // Prevent console warnings when many extensions are installed
			socket.on('message', function onMessage(data, cb) {
				self.log.trace('[%s] Received message %s (sent to bundle %s) with data:',
					self.bundleName, data.messageName, data.bundleName, data.content);

				self._messageHandlers.forEach(function (handler) {
					if (data.messageName === handler.messageName &&
						data.bundleName === handler.bundleName) {
						handler.func(data.content, cb);
					}
				});
			});
		});
	}

	// Create read-only config property, which contains the current filtered NodeCG config
	Object.defineProperty(this, 'config', {
		value: filteredConfig,
		writable: false,
		enumerable: true
	});

	Object.freeze(this.config);
}

// ###NodeCG prototype

/**
 * Sends a message with optional data within the current bundle.
 * Messages can be sent from client to server, server to client, or client to client.
 *
 * Messages are namespaced by bundle. To send a message in another bundle's namespace,
 * use {@link NodeCG#sendMessageToBundle}.
 *
 * If a message is sent from a client (graphic or dashboard panel), to the server (an extension),
 * it may provide an optional callback called an `acknowledgement`.
 * Acknowledgements will not work for client-to-client nor server-to-client messages.
 * Only client-to-server messages support acknowledgements. This restriction is a limitation of
 * [Socket.IO](http://socket.io/docs/#sending-and-getting-data-%28acknowledgements%29).
 *
 * @param {string} messageName - The name of the message.
 * @param {mixed} [data] - The data to send.
 * @param {function} [cb] - _Browser only_ The callback to handle the server's
 * [acknowledgement](http://socket.io/docs/#sending-and-getting-data-%28acknowledgements%29) message, if any.
 *
 * @example <caption>Sending a normal message:</caption>
 * nodecg.sendMessage('printMessage', 'dope.');
 *
 * @example <caption>Sending a message and calling back with an acknowledgement:</caption>
 * // bundles/my-bundle/extension.js
 * module.exports = function(nodecg) {
 *     nodecg.listenFor('multiplyByTwo', function(value, callback) {
 *          callback(value * 2);
 *     });
 * }
 *
 * // bundles/my-bundle/graphics/script.js
 * nodecg.sendMessage('multiplyByTwo', 2, function(result) {
 *     console.log(result); // Will eventually print '4'
 * });
 */
NodeCG.prototype.sendMessage = function (messageName, data, cb) {
	if (typeof cb === 'undefined' && typeof data === 'function') {
		cb = data;
		data = null;
	}

	this.sendMessageToBundle(messageName, this.bundleName, data, cb);
};

NodeCG.sendMessageToBundle = function (messageName, bundleName, data, cb) {
	if (process.env.browser) {
		if (typeof cb === 'undefined' && typeof data === 'function') {
			cb = data;
			data = null;
		}

		window.socket.emit('message', {
			bundleName: bundleName,
			messageName: messageName,
			content: data
		}, cb);
	} else {
		io.emit('message', {
			bundleName: bundleName,
			messageName: messageName,
			content: data
		});
	}
};

/**
 * Sends a message to a specific bundle. Also available as a static method.
 * See {@link NodeCG#sendMessage} for usage details.
 * @param {string} messageName - The name of the message.
 * @param {string} bundleName - The name of the target bundle.
 * @param {mixed} [data] - The data to send.
 * @param {function} [cb] - _Browser only_ The callback to handle the server's
 * [acknowledgement](http://socket.io/docs/#sending-and-getting-data-%28acknowledgements%29) message, if any.
 */
/* eslint-disable no-unused-vars */
NodeCG.prototype.sendMessageToBundle = function (messageName, bundleName, data, cb) {
	this.log.trace('[%s] Sending message %s to bundle %s with data:',
		this.bundleName, messageName, bundleName, data);

	NodeCG.sendMessageToBundle.apply(NodeCG, arguments);
};
/* eslint-enable no-unused-vars */

/**
 * Listens for a message, and invokes the provided callback each time the message is received.
 * If any data was sent with the message, it will be passed to the callback.
 *
 * Messages are namespaced by bundle.
 * To listen to a message in another bundle's namespace, provide it as the second argument.
 *
 * @param {string} messageName - The name of the message.
 * @param {string} [bundleName=CURR_BNDL] - The bundle namespace to in which to listen for this message
 * @param {function} handler - The callback fired when this message is received.
 *
 * @example
 * nodecg.listenFor('printMessage', function (message) {
 *     console.log(message);
 * });
 *
 * @example <caption>Listening to a message in another bundle's namespace:</caption>
 * nodecg.listenFor('printMessage', 'another-bundle', function (message) {
 *     console.log(message);
 * });
 */
NodeCG.prototype.listenFor = function (messageName, bundleName, handler) {
	if (typeof handler === 'undefined') {
		handler = bundleName;
		bundleName = this.bundleName;
	}

	this.log.trace('[%s] Listening for %s from bundle %s', this.bundleName, messageName, bundleName);

	// Check if a handler already exists for this message
	var len = this._messageHandlers.length;
	for (var i = 0; i < len; i++) {
		var existingHandler = this._messageHandlers[i];
		if (messageName === existingHandler.messageName && bundleName === existingHandler.bundleName) {
			this.log.error('%s attempted to declare a duplicate "listenFor" handler:',
				this.bundleName, bundleName, messageName);
			return;
		}
	}

	this._messageHandlers.push({
		messageName: messageName,
		bundleName: bundleName,
		func: handler
	});
};

/**
 * An object containing references to all Replicants that have been declared in this `window`, sorted by bundle.
 * E.g., `NodeCG.declaredReplicants.myBundle.myRep`
 */
NodeCG.declaredReplicants = Replicant.declaredReplicants;

NodeCG.Replicant = function (name, bundle, opts) {
	return new Replicant(name, bundle, opts, process.env.browser ? window.socket : null);
};

/**
 * Replicants are objcts which monitor changes to a variable's value.
 * The changes are replicated across all extensions, graphics, and dashboard panels.
 * When a Replicant changes in one of those places it is quickly updated in the rest,
 * and a `change` event is emitted allowing bundles to react to the changes in the data.
 *
 * If a Replicant with a given name in a given bundle namespace has already been declared,
 * the Replicant will automatically be assigned the existing value.
 *
 * Replicants must be declared in each context that wishes to use them. For instance,
 * declaring a replicant in an extension does not automatically make it available in a graphic.
 * The graphic must also declare it.
 *
 * By default Replicants will be saved to disk, meaning they will automatically be restored when NodeCG is restarted,
 * such as after an unexpected crash.
 * If you need to opt-out of this behaviour simply set `persistent: false` in the `opts` argument.
 *
 * @param {string} name - The name of the replicant.
 * @param {string} [bundle=CURR_BNDL] - The bundle namespace to in which to look for this replicant.
 * @param {object} [opts] - The options for this replicant.
 * @param {mixed} [opts.defaultValue] - The default value to instantiate this Replicant with. The default value is only
 * applied if this Replicant has not previously been declared and if it has no persisted value.
 * @param {boolean} [opts.persistent=true] - Whether to persist the Replicant's value to disk on every change.
 * Persisted values are re-loaded on startup.
 *
 * @example
 * var myVar = nodecg.Replicant('myVar', {defaultValue: 123});
 *
 * myVar.on('change', function(oldValue, newValue) {
 *     console.log('myVar changed from '+ oldValue +' to '+ newValue);
 * });
 *
 * myVar.value = 'Hello!';
 * myVar.value = {objects: 'work too!'};
 * myVar.value = {objects: {can: {be: 'nested!'}}};
 * myVar.value = ['Even', 'arrays', 'work!'];
 */
NodeCG.prototype.Replicant = function (name, bundle, opts) {
	if (!bundle || typeof bundle !== 'string') {
		opts = bundle;
		bundle = this.bundleName;
	}

	return new NodeCG.Replicant(name, bundle, opts);
};

NodeCG.readReplicant = function (name, bundle, cb) {
	if (!name || typeof name !== 'string') {
		throw new Error('Must supply a name when reading a Replicant');
	}

	if (!bundle || typeof bundle !== 'string') {
		throw new Error('Must supply a bundle name when reading a Replicant');
	}

	if (process.env.browser) {
		window.socket.emit('readReplicant', {name: name, bundle: bundle}, cb);
	} else {
		var replicant = replicator.find(name, bundle);
		if (replicant) {
			return replicant.value;
		}
	}
};

/**
 * Reads the value of a replicant once, and doesn't create a subscription to it. Also available as a static method.
 * @param {string} name - The name of the replicant.
 * @param {string} [bundle=CURR_BNDL] - The bundle namespace to in which to look for this replicant.
 * @param {function} cb - _Browser only_ The callback that handles the server's response which contains the value.
 * @example <caption>From an extension:</caption>
 * // Extensions have immediate access to the database of Replicants.
 * // For this reason, they can use readReplicant synchronously, without a callback.
 * module.exports = function(nodecg) {
 *     var myVal = nodecg.readReplicant('myVar', 'some-bundle');
 * }
 * @example <caption>From a graphic or dashboard panel:</caption>
 * // Graphics and dashboard panels must query the server to retrieve the value,
 * // and therefore must provide a callback.
 * nodecg.readSyncedVar('myVar', 'some-bundle', function(value) {
 *     // I can use 'value' now!
 *     console.log('myVar has the value '+ value +'!');
 * });
 */
NodeCG.prototype.readReplicant = function (name, bundle, cb) {
	if (!bundle || typeof bundle !== 'string') {
		cb = bundle;
		bundle = this.bundleName;
	}

	return NodeCG.readReplicant(name, bundle, cb);
};

if (process.env.browser) {
	window.NodeCG = NodeCG;

	/**
	 * _Browser only_<br/>
	 * Returns the nearest element with the desired attribute.
	 * Begins at `startEl` and then checks every parent, returning the first one that has the attribute.
	 * Returns undefined if neither `startEl` nor any of its parents has the attribute.
	 * @param {object} startEl - The element on which to begin the search.
	 * @param {string} attrName - The attribute name to look for.
	 * @returns {object}
	 */
	NodeCG.nearestElementWithAttribute = function (startEl, attrName) {
		var target = startEl;
		while (target) {
			if (target.hasAttribute) {
				if (target.hasAttribute(attrName)) {
					return target;
				}
			}
			target = target.parentNode;
		}
	};

	/**
	 * _Browser only_<br/>
	 * Returns the specified dialog element.
	 * @param {string} name - The desired dialog's name.
	 * @param {string} [bundle=CURR_BNDL] - The bundle from which to select the dialog.
	 * @returns {object}
	 */
	NodeCG.prototype.getDialog = function (name, bundle) {
		bundle = bundle || this.bundleName;
		var topDoc = window.top.document;
		return topDoc.getElementById(bundle + '_' + name);
	};

	/**
	 * _Browser only_<br/>
	 * Returns the specified dialog's iframe document.
	 * @param {string} name - The desired dialog's name.
	 * @param {string} [bundle=CURR_BNDL] - The bundle from which to select the dialog.
	 * @returns {object}
	 */
	NodeCG.prototype.getDialogDocument = function (name, bundle) {
		bundle = bundle || this.bundleName;
		var dialog = this.getDialog(name, bundle);
		return dialog.querySelector('iframe').contentWindow.document;
	};
} else {
	/**
	 * _Extension only_<br/>
	 * Gets the server Socket.IO context.
	 * @function
	 */
	NodeCG.prototype.getSocketIOServer = server.getIO;

	/**
	 * _Extension only_<br/>
	 * Mounts express middleware to the main server express app.
	 * See the [express docs](http://expressjs.com/en/api.html#app.use) for usage.
	 * @function
	 */
	NodeCG.prototype.mount = server.mount;

	NodeCG.prototype.util = {};

	/**
	 * _Extension only_<br/>
	 * Checks if a session is authorized. Intended to be used in express routes.
	 * @param {object} req - A HTTP request.
	 * @param {object} res - A HTTP response.
	 * @param {function} next - The next middleware in the control flow.
	 */
	NodeCG.prototype.util.authCheck = utils.authCheck;

	/**
	 * _Extension only_<br/>
	 * Finds and returns a session that matches the given parameters.
	 * @param {object} params - A NeDB search query [https://github.com/louischatriot/nedb#finding-documents].
	 * @returns {object}
	 */
	NodeCG.prototype.util.findSession = utils.findSession;

	/**
	 * _Extension only_<br/>
	 * Object containing references to all other loaded extensions. To access another bundle's extension,
	 * it _must_ be declared as a `bundleDependency` in your bundle's [`package.json`]{@tutorial manifest}.
	 * @property {Object}
	 * @name NodeCG#extensions
	 *
	 * @example
	 * // bundles/my-bundle/package.json
	 * {
     *     "name": "my-bundle"
     *     ...
     *     "bundleDependencies": {
     *         "other-bundle": "^1.0.0"
     *     }
     * }
	 *
	 * // bundles/my-bundle/extension.js
	 * module.exports = function(nodecg) {
     *     var otherBundle = nodecg.extensions['other-bundle'];
     *     // Now I can use `otherBundle`!
     * }
	 */
	Object.defineProperty(NodeCG.prototype, 'extensions', {
		get: function () {
			return server.getExtensions();
		},
		enumerable: true
	});
}

module.exports = NodeCG;
