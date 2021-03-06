'use strict';

var istanbul = require('browserify-istanbul');

module.exports = function (grunt) {
	require('load-grunt-tasks')(grunt);

	grunt.initConfig({
		browserify: {
			dist: {
				files: {
					'./lib/browser/dist/browserifiedApi.min.js': 'lib/api.js'
				},
				options: {
					browserifyOptions: {
						debug: true
					},
					plugin: [
						['minifyify', {
							map: '/nodecg-api.map.json',
							output: 'lib/browser/dist/browserifiedApi.map.json'
						}]
					],
					transform: [
						['aliasify', {
							aliases: {
								'./logger': './lib/browser/logger',
								'./replicant': './lib/browser/replicant',
								'./config': './lib/browser/config'
							},
							verbose: false
						}],
						['envify', {
							_: 'purge',
							browser: true
						}],
						'brfs'
					],
					ignore: [
						'./lib/server/index.js',
						'./lib/replicator.js',
						'./lib/util.js'
					]
				}
			},
			coverage: {
				files: {
					'./lib/browser/dist/browserifiedTestApi.js': 'lib/api.js'
				},
				options: {
					browserifyOptions: {
						debug: true
					},
					transform: [
						['aliasify', {
							aliases: {
								'./logger': './lib/browser/logger',
								'./replicant': './lib/browser/replicant',
								'./config': './lib/browser/config'
							},
							verbose: false
						}],
						['envify', {
							_: 'purge',
							browser: true
						}],
						'brfs',
						istanbul
					],
					ignore: [
						'./lib/server/index.js',
						'./lib/replicator.js',
						'./lib/util.js'
					]
				}
			}
		}
	});

	grunt.registerTask('default', ['browserify:dist']);
};
