/* eslint-env node, mocha, browser */
/* eslint-disable new-cap, camelcase, max-nested-callbacks */
'use strict';

var chai = require('chai');
var expect = chai.expect;
var fs = require('fs');
var e = require('./setup/test-environment');

describe('client-side replicants', function () {
	this.timeout(10000);

	before(function (done) {
		e.browser.client
			.switchTab(e.browser.tabs.dashboard)
			.call(done);
	});

	it('should only apply defaultValue when first declared', function (done) {
		e.apis.extension.Replicant('clientTest', {defaultValue: 'foo', persistent: false});

		e.browser.client
			.executeAsync(function (done) {
				var rep = window.dashboardApi.Replicant('clientTest', {defaultValue: 'bar'});
				rep.on('declared', function () {
					done(rep.value);
				});
			})
			.then(function (ret) {
				expect(ret.value).to.equal('foo');

				done();
			});
	});

	it('should be readable without subscription, via readReplicant', function (done) {
		e.browser.client
			.executeAsync(function (done) {
				window.dashboardApi.readReplicant('clientTest', done);
			})
			.then(function (ret) {
				expect(ret.value).to.equal('foo');

				done();
			});
	});

	it('should throw an error when no name is provided', function (done) {
		e.browser.client
			.executeAsync(function (done) {
				try {
					window.dashboardApi.Replicant();
				} catch (e) {
					done(e.message);
				}
			})
			.then(function (ret) {
				expect(ret.value).to.equal('Must supply a name when instantiating a Replicant');

				done();
			});
	});

	it('should be assignable via the ".value" property', function (done) {
		e.browser.client
			.executeAsync(function (done) {
				var rep = window.dashboardApi.Replicant('clientAssignmentTest', {persistent: false});
				rep.on('assignmentAccepted', function (data) {
					done(data);
				});
				rep.value = 'assignmentOK';
			})
			.then(function (ret) {
				expect(ret.value.newValue).to.equal('assignmentOK');
				expect(ret.value.revision).to.equal(1);

				done();
			});
	});

	it('should react to changes in arrays', function (done) {
		e.browser.client
			.executeAsync(function (done) {
				var rep = window.dashboardApi.Replicant('clientArrTest', {
					persistent: false,
					defaultValue: ['starting']
				});

				rep.on('declared', function () {
					rep.on('change', function (oldVal, newVal, changes) {
						if (oldVal && newVal && changes) {
							done({
								oldVal: oldVal,
								newVal: newVal,
								changes: changes
							});
						}
					});

					rep.value.push('arrPushOK');
				});
			})
			.then(function (ret) {
				expect(ret.value.oldVal).to.deep.equal(['starting']);
				expect(ret.value.newVal).to.deep.equal(['starting', 'arrPushOK']);
				expect(ret.value.changes).to.have.length(1);
				expect(ret.value.changes[0].type).to.equal('splice');
				expect(ret.value.changes[0].removed).to.deep.equal([]);
				expect(ret.value.changes[0].removedCount).to.equal(0);
				expect(ret.value.changes[0].added).to.deep.equal(['arrPushOK']);
				expect(ret.value.changes[0].addedCount).to.equal(1);

				done();
			});
	});

	// need a better way to test this
	it.skip('should redeclare after reconnecting to Socket.IO', function (done) {
		this.timeout(30000);

		e.browser.client
			.executeAsync(function (done) {
				window.clientRedeclare = window.dashboardApi.Replicant('clientRedeclare', {
					defaultValue: 'foo',
					persistent: false
				});

				window.clientRedeclare.once('declared', function () {
					done();
				});
			})
			.then(function () {
				e.server.once('stopped', function () {
					e.browser.client
						.executeAsync(function (done) {
							window.clientRedeclare.once('declared', function () {
								done();
							});
						})
						.call(done);

					e.server.start();
				});

				e.server.stop();
			});
	});

	context('when an object', function () {
		it('should not cause server-side replicants to lose observation', function (done) {
			var rep = e.apis.extension.Replicant('clientServerObservation', {
				defaultValue: {foo: 'foo'},
				persistent: false
			});

			e.browser.client
				.executeAsync(function (done) {
					var rep = window.dashboardApi.Replicant('clientServerObservation');

					rep.on('change', function (oldVal, newVal) {
						if (newVal.foo === 'bar') {
							done(newVal);
						} else {
							rep.value.foo = 'bar';
						}
					});
				})
				.then(function (ret) {
					expect(ret.value).to.deep.equal({foo: 'bar'});

					rep.on('change', function (oldVal, newVal) {
						if (newVal.foo === 'baz') {
							done();
						}
					});

					rep.value.foo = 'baz';
				});
		});

		it('should react to changes in nested properties', function (done) {
			e.browser.client
				.executeAsync(function (done) {
					var rep = window.dashboardApi.Replicant('clientObjTest', {
						persistent: false,
						defaultValue: {a: {b: {c: 'c'}}}
					});

					rep.on('declared', function () {
						rep.on('change', function (oldVal, newVal, changes) {
							if (oldVal && newVal && changes) {
								done({
									oldVal: oldVal,
									newVal: newVal,
									changes: changes
								});
							}
						});

						rep.value.a.b.c = 'nestedChangeOK';
					});
				})
				.then(function (ret) {
					expect(ret.value.oldVal).to.deep.equal({a: {b: {c: 'c'}}});
					expect(ret.value.newVal).to.deep.equal({a: {b: {c: 'nestedChangeOK'}}});
					expect(ret.value.changes).to.have.length(1);
					expect(ret.value.changes[0].type).to.equal('update');
					expect(ret.value.changes[0].path).to.deep.equal(['a', 'b', 'c']);
					expect(ret.value.changes[0].oldValue).to.equal('c');
					expect(ret.value.changes[0].newValue).to.equal('nestedChangeOK');

					done();
				});
		});

		// This specifically tests the following case:
		// When the server has a replicant with an array nested inside an object, and that array changes,
		// the server should detect that change event, emit it to all clients,
		// and the clients should then digest that change and emit a "change" event.
		// This test is to address a very specific bug reported by Love Olsson.
		/* jshint -W106 */
		it('should react to server-side changes of array properties', function (done) {
			var serverRep = e.apis.extension.Replicant('s2c_nestedArrTest', {
				persistent: false,
				defaultValue: {
					arr: []
				}
			});

			e.browser.client
				.executeAsync(function (done) {
					window.s2c_nestedArrTest = window.dashboardApi.Replicant('s2c_nestedArrTest');
					window.s2c_nestedArrTest.on('declared', function () {
						done();

						window.s2c_nestedArrTest.on('change', function (oldVal, newVal, changes) {
							if (oldVal && newVal && changes) {
								window.s2c_nestedArrChange = {
									oldVal: oldVal,
									newVal: newVal,
									changes: changes
								};
							}
						});
					});
				})
				.call(function () {
					serverRep.value.arr.push('test');
				})
				.executeAsync(function (done) {
					var interval = setInterval(function () {
						if (window.s2c_nestedArrChange) {
							clearInterval(interval);
							done(window.s2c_nestedArrChange);
						}
					}, 50);
				})
				.then(function (ret) {
					expect(ret.value.oldVal).to.deep.equal({arr: []});
					expect(ret.value.newVal).to.deep.equal({arr: ['test']});
					expect(ret.value.changes).to.have.length(1);
					expect(ret.value.changes[0].type).to.equal('splice');
					expect(ret.value.changes[0].path).to.deep.equal(['arr']);
					expect(ret.value.changes[0].added).to.deep.equal(['test']);
					expect(ret.value.changes[0].addedCount).to.equal(1);
					expect(ret.value.changes[0].removedCount).to.equal(0);

					done();
				});
		});
		/* jshint +W106 */
	});

	context('when "persistent" is set to "true"', function () {
		it('should load persisted values when they exist', function (done) {
			e.browser.client
				.executeAsync(function (done) {
					var rep = window.dashboardApi.Replicant('clientPersistence');
					rep.on('declared', function () {
						done(rep.value);
					});
				})
				.then(function (ret) {
					expect(ret.value).to.equal('it work good!');

					done();
				});
		});

		it('should persist assignment to disk', function (done) {
			e.browser.client
				.executeAsync(function (done) {
					var rep = window.dashboardApi.Replicant('clientPersistence');
					rep.value = {nested: 'hey we assigned!'};
					rep.on('assignmentAccepted', function () {
						done();
					});
				})
				.then(function () {
					fs.readFile('./db/replicants/test-bundle/clientPersistence.rep', 'utf-8', function (err, data) {
						if (err) {
							throw err;
						}

						expect(data).to.equal('{"nested":"hey we assigned!"}');
						done();
					});
				});
		});

		it('should persist changes to disk', function (done) {
			var serverRep = e.apis.extension.Replicant('clientChangePersistence', {defaultValue: {nested: ''}});
			e.browser.client
				.executeAsync(function (done) {
					window.clientChangePersistence = window.dashboardApi.Replicant('clientChangePersistence');
					window.clientChangePersistence.once('change', function () {
						done();
					});
				})
				.then(function () {
					serverRep.on('change', function (oldVal, newVal) {
						if (newVal.nested !== 'hey we changed!') {
							return;
						}

						// On a short timeout to give the Replicator time to write the new value to disk
						setTimeout(function () {
							var data = fs.readFileSync('./db/replicants/test-bundle/clientChangePersistence.rep',
								'utf-8');
							expect(data).to.equal('{"nested":"hey we changed!"}');
							done();
						}, 10);
					});
				})
				.execute(function () {
					window.clientChangePersistence.value.nested = 'hey we changed!';
				});
		});

		it('should persist falsey values to disk', function (done) {
			e.browser.client
				.executeAsync(function (done) {
					var rep = window.dashboardApi.Replicant('clientFalseyWrite');
					rep.value = 0;
					rep.on('assignmentAccepted', function () {
						done();
					});
				})
				.then(function () {
					fs.readFile('./db/replicants/test-bundle/clientFalseyWrite.rep', 'utf-8', function (err, data) {
						if (err) {
							throw err;
						}

						expect(data).to.equal('0');
						done();
					});
				});
		});

		it('should read falsey values from disk', function (done) {
			e.browser.client
				.executeAsync(function (done) {
					var rep = window.dashboardApi.Replicant('clientFalseyRead');
					rep.on('declared', function () {
						done(rep.value);
					});
				})
				.then(function (ret) {
					expect(ret.value).to.equal(0);

					done();
				});
		});
	});

	context('when "persistent" is set to "false"', function () {
		it('should not write their value to disk', function (done) {
			fs.unlink('./db/replicants/test-bundle/clientTransience.rep', function (err) {
				if (err && err.code !== 'ENOENT') {
					throw err;
				}

				e.browser.client
					.executeAsync(function (done) {
						var rep = window.dashboardApi.Replicant('clientTransience', {
							defaultValue: 'o no',
							persistent: false
						});

						rep.on('declared', function () {
							done();
						});
					})
					.then(function () {
						fs.readFile('./db/replicants/test-bundle/clientTransience.rep', function (err) {
							expect(function () {
								if (err) {
									throw err;
								}
							}).to.throw(/ENOENT/);
						});
					})
					.call(done);
			});
		});
	});
});

describe('server-side replicants', function () {
	it('should only apply defaultValue when first declared', function (done) {
		this.timeout(10000);

		e.browser.client
			.switchTab(e.browser.tabs.dashboard)
			.executeAsync(function (done) {
				var rep = window.dashboardApi.Replicant('extensionTest', {defaultValue: 'foo', persistent: false});
				rep.on('declared', function () {
					done();
				});
			})
			.then(function () {
				var rep = e.apis.extension.Replicant('extensionTest', {defaultValue: 'bar'});
				expect(rep.value).to.equal('foo');

				done();
			});
	});

	it('should be readable without subscription, via readReplicant', function () {
		expect(e.apis.extension.readReplicant('extensionTest')).to.equal('foo');
	});

	it('should throw an error when no name is provided', function () {
		expect(function () {
			e.apis.extension.Replicant();
		}).to.throw(/Must supply a name when instantiating a Replicant/);
	});

	it('should be assignable via the ".value" property', function () {
		var rep = e.apis.extension.Replicant('extensionAssignmentTest', {persistent: false});
		rep.value = 'assignmentOK';
		expect(rep.value).to.equal('assignmentOK');
	});

	it('should react to changes in nested properties of objects', function (done) {
		var rep = e.apis.extension.Replicant('extensionObjTest', {
			persistent: false,
			defaultValue: {a: {b: {c: 'c'}}}
		});

		rep.on('change', function (oldVal, newVal, changes) {
			if (newVal.a.b.c !== 'nestedChangeOK') {
				return;
			}

			expect(oldVal).to.deep.equal({a: {b: {c: 'c'}}});
			expect(newVal).to.deep.equal({a: {b: {c: 'nestedChangeOK'}}});
			expect(changes).to.have.length(1);
			expect(changes[0].type).to.equal('update');
			expect(changes[0].path).to.deep.equal(['a', 'b', 'c']);
			expect(changes[0].oldValue).to.equal('c');
			expect(changes[0].newValue).to.equal('nestedChangeOK');
			done();
		});

		rep.value.a.b.c = 'nestedChangeOK';
	});

	it('should react to changes in arrays', function (done) {
		var rep = e.apis.extension.Replicant('extensionArrTest', {
			persistent: false,
			defaultValue: ['starting']
		});

		rep.on('change', function (oldVal, newVal, changes) {
			if (!changes || changes[0].added[0] !== 'arrPushOK') {
				return;
			}

			expect(oldVal).to.deep.equal(['starting']);
			expect(newVal).to.deep.equal(['starting', 'arrPushOK']);
			expect(changes).to.have.length(1);
			expect(changes[0].type).to.equal('splice');
			expect(changes[0].removed).to.deep.equal([]);
			expect(changes[0].removedCount).to.equal(0);
			expect(changes[0].added).to.deep.equal(['arrPushOK']);
			expect(changes[0].addedCount).to.equal(1);
			done();
		});

		rep.value.push('arrPushOK');
	});

	it('should only apply array splices from the client once', function (done) {
		this.timeout(10000);

		var serverRep = e.apis.extension.Replicant('clientDoubleApplyTest', {persistent: false, defaultValue: []});

		e.browser.client
			.switchTab(e.browser.tabs.dashboard)
			.executeAsync(function (done) {
				window.clientDoubleApplyTest = window.dashboardApi.Replicant('clientDoubleApplyTest');

				window.clientDoubleApplyTest.on('declared', function () {
					window.clientDoubleApplyTest.on('change', function () {
						done();
					});
				});
			})
			.then(function () {
				serverRep.on('change', function (oldVal, newVal) {
					if (Array.isArray(newVal) && newVal[0] === 'test') {
						expect(newVal).to.deep.equal(['test']);
						done();
					}
				});
			})
			.execute(function () {
				window.clientDoubleApplyTest.value.push('test');
			});
	});

	context('when "persistent" is set to "true"', function () {
		it('should load persisted values when they exist', function () {
			var rep = e.apis.extension.Replicant('extensionPersistence');
			expect(rep.value).to.equal('it work good!');
		});

		it('should persist assignment to disk', function (done) {
			var rep = e.apis.extension.Replicant('extensionPersistence');
			rep.value = {nested: 'hey we assigned!'};
			setTimeout(function () {
				fs.readFile('./db/replicants/test-bundle/extensionPersistence.rep', 'utf-8', function (err, data) {
					if (err) {
						throw err;
					}

					expect(data).to.equal('{"nested":"hey we assigned!"}');
					done();
				});
			}, 10);
		});

		it('should persist changes to disk', function (done) {
			var rep = e.apis.extension.Replicant('extensionPersistence');
			rep.value.nested = 'hey we changed!';
			setTimeout(function () {
				fs.readFile('./db/replicants/test-bundle/extensionPersistence.rep', 'utf-8', function (err, data) {
					if (err) {
						throw err;
					}

					expect(data).to.equal('{"nested":"hey we changed!"}');
					done();
				});
			}, 10);
		});

		it('should persist falsey values to disk', function (done) {
			var rep = e.apis.extension.Replicant('extensionFalseyWrite');
			rep.value = 0;
			setTimeout(function () {
				fs.readFile('./db/replicants/test-bundle/extensionFalseyWrite.rep', 'utf-8', function (err, data) {
					if (err) {
						throw err;
					}

					expect(data).to.equal('0');
					done();
				});
			}, 10);
		});

		it('should read falsey values from disk', function () {
			var rep = e.apis.extension.Replicant('extensionFalseyRead');
			expect(rep.value).to.equal(0);
		});
	});

	context('when "persistent" is set to "false"', function () {
		it('should not write their value to disk', function (done) {
			// Remove the file if it exists for some reason
			fs.unlink('./db/replicants/test-bundle/extensionTransience.rep', function (err) {
				if (err && err.code !== 'ENOENT') {
					throw err;
				}

				var rep = e.apis.extension.Replicant('extensionTransience', {persistent: false});
				rep.value = 'o no';
				fs.readFile('./db/replicants/test-bundle/extensionTransience.rep', function (err) {
					expect(function () {
						if (err) {
							throw err;
						}
					}).to.throw(/ENOENT/);
					done();
				});
			});
		});
	});
});
