var _ = require('lodash');
var debug = require('debug')('block-head');
var fspath = require('path');
var gulp = require('gulp');
var parseAttributes = require('parse-attributes');
var through = require('through2');
var Vinyl = require('vinyl');
var vm = require('vm');

var blockHead = function(options) {
	var settings = {
		default: false,
		backpressure: 'warn', // False = ignore, True = Error on backpressure, 'warn' - Warn but continue, Number - set to a timeout to retry automatically
		blocks: {},
		...options,
	};

	if (!_.isArray(settings.blocks) && _.isObject(settings.blocks)) { // Flatten lookup object into an array
		settings.blocks = Object.keys(settings.blocks).map(id => {
			var block =
				_.isFunction(settings.blocks[id]) ? {transform: settings.blocks[id]} // Shorthand definition
				: settings.blocks[id];

			block.id = id;
			return block;
		});
	}

	// Error check the blocks
	settings.blocks = settings.blocks.map(block => ({
		matchStart: new RegExp(`^<${block.id}(\s*.+?\s*)?>$`),
		matchEnd: new RegExp(`^</${block.id}>$`),
		transform: contents => contents,
		name: (path, block) => `${path}#${block.id}`,
		sort: 0,
		ignore: false,
		...block,
	}))

	return through.obj(function(file, enc, done) {
		var stream = this;

		if (file.isBuffer()) {
			var lines = file.contents.toString().split('\n');
			var block = false; // Either boolean false or the block reference we are in
			var foundBlocks = [];
			var ignoreCount = 0;

			lines.forEach((line, lineNumber) => {
				if (!block) { // Not yet in a block
					block = settings.blocks.find(b => {
						var match = b.matchStart.exec(line);
						if (match) {
							block = b;
							block.attr = parseAttributes(match[1]);
							return true;
						} else {
							return false;
						}
					});
					if (block) { // Start of a new block
						block.lineOffset = lineNumber + 1;
					}
				} else if (block.matchEnd.test(line)) { // End of a block
					if (
						block.ignore === true
						|| (typeof block.ignore == 'function' && block.ignore(file.path, block))
					) { // Ignore block
						debug(`Ignore block "${block.id}"`, file.path, `due to ignore result`);
						ignoreCount++;
						// Do nothing
					} else { // Include block
						var vObject = new Vinyl({
							path: block.name(file.path, block),
							contents: new Buffer.from(
								block.transform(
									lines.slice(block.lineOffset, lineNumber).join('\n'),
									file.path,
									block
								) || ''
							),
							stat: file.stat,
						});

						foundBlocks.push({
							lineOffset: block.lineOffset,
							sort:
								! block.sort ? 0
								: typeof block.sort == 'function' ? block.sort(file.path, block)
								: block.sort,
							vinyl: vObject,
						});
					}

					block = false;
				}
			});

			if (block) { // Still in a block even though we exited? Missing closing block syntax
				done(`Missing closing block syntax in ${file.path} - block "${block.id}" not closed with ${block.matchEnd}`);
			} else if (foundBlocks.length) { // Found some blocks
				Promise.all(
					foundBlocks
						.sort((a, b) => a.sort == b.sort ? 0 : a.sort > b.sort ? 1 : -1)
						.map(block => new Promise((resolve, reject) => {
							debug(`extracted file "${block.vinyl.path}" +${block.lineOffset+1} (${Math.ceil(block.vinyl.contents.length / 1024)}kb)`);
							var tryPush = ()=> {
								if (this.push(block.vinyl)) {
									resolve();
								} else if (isFinite(settings.backpressure)) {
									debug('Backpressure detected, try again in', settings.backpressure);
									setTimeout(tryPush, settings.backpressure);
								} else if (settings.backpressure === false) {
									reject('Cannot continue buffering due to backpressure');
								} else if (settings.backpressure === true) {
									debug('Backpressure detected, ignoring');
									resolve();
								} else if (settings.backpressure === 'warn') {
									console.warn(`Warning, backpressure encounted while processing block "${block.id}" in "${block.vinyl.path}" +${block.lineOffset+1}`);
									resolve();
								} else {
									reject('Backpressure encounted but unsupported method specified to handle it');
								}
							};
							tryPush();
						}))
				).then(()=> done()).catch(done) // Remove input content
			} else if (!foundBlocks.length && !ignoreCount && typeof settings.default == 'object') { // No blocks extracted and we have a definition for a default
				if (settings.default.include) { // Check if we should include this at all
					if (!settings.default.include(file.path)) return done();
				}

				var vObject = {
					path: settings.default.name ? settings.default.name(file.path, settings.default) : file.path,
					contents: new Buffer.from(
						settings.default.transform
							? settings.default.transform(file.contents.toString(), file.path) || ''
							: file.contents
					),
					stat: file.stat,
				};

				debug(`Extracted default file "${vObject.path}" (${Math.ceil(vObject.contents.length / 1024)}kb)`);

				stream.push(new Vinyl(vObject))
				done(); // Remove input content
			} else if (settings.default === false) { // Remove the file from the stream
				done(); // Remove input content
			} else { // Give up and remove the file from the stream
				debug('Skipping unknown file contents', file.path);
				done();
			}
		} else if (file.isNull()) {
			debug('Handed null - ignoring');
			done(null, file);
		} else if (file.isStream()) {
			debug('Handed stream - erroring');
			done('Gulp-block-head - Streams are not yet supported');
		} else {
			debug('Handed unknown - erroring');
			done('Unknown format');
		}
	});
};


/**
* Shorthand function for reading in a file and processing the designated blocks as being called using the standard `import(file)`
* NOTE: Because of limitations with Vinyl streams this function returns a promise and does not block unlike the usual 'require'
* This function is designed to be used in native Node rather than a Gulp chain
* @param {string} files A single file path glob expression or any valid gulp.src() expression, to specify additional gulp.src options use options.src
* @param {array|string|Object} [options="backend"] Either an array or single block name to accept and process or an options object, if the former the value is assigned to options.blocks
* @param {array|string|Object} [options.blocks] The blocks to accept, can be a single block string, an array of acceptable blocks or a full blockHead definition (in which case no mutation happens)
* @param {Object} [options.src] Additional parameters passed to `gulp.src(files, #)` when reading the file input
* @param {boolean|Object} [options.sandbox=false] The sandbox to use when running the script in a VM. If false the code is run in this context which allows all globals to be available
* @returns {Promise} A promise which will resolve when all files have been run
*/
var blockHeadImport = function(files, options) {
	// Settings + Argument mangling {{{
	var settings = {
		blocks: ['backend'],
		sandbox: false,
		src: {},
	};

	if (_.isString(options)) {
		settings.blocks = [options];
	} else if (_.isArray(options)) {
		settings.blocks = options;
	} else if (_.isObject(options)) {
		Object.assign(settings, options);
		if (_.isString(settings.blocks)) settings.blocks = [settings.blocks];
	} else {
		throw "Unsupported options.block value";
	}
	// }}}

	// Glue VM structure into each block {{{
	settings.blocks = _(settings.blocks) // Transform blocks into collection
		.thru(v =>
			_.isString(v) ? [{id: v}] // String? Map into minimal collection
			: _.isArray(v) ? _.map(v, v => // Array? Unpack
				_.isString(v) ? {id: v} // Array of strings
				: _.set(v, 'id', k)
			) // Array? Map into minimal collection
			: _.isObject(v) ? _.map(v, (v, k) => // Transform object into array...
				_.isString(v) // Given object <string>?
					? {id: k} // Map into minimal object
					: _.set(v, 'id', k) // Extend object <object>... Glue id into array
			)
			: v // ...No idea, just pass through
		)
		.map(v => _.defaults(v, {
			name: path => path,
			transform: (content, path, block) => {
				try {
					if (settings.sandbox === false) {
						vm.runInThisContext(
							content,
							{
								filename: path,
								lineOffset: block.lineOffset,
							}
						);
					} else {
						vm.runInNewContext(
							content,
							Object.assign({}, settings.sandbox, {
								script: {
									file: fspath.basename(path),
									line: block.lineOffset + 1, // Offsets are zero based
								},
							}),
							{
								filename: path,
								lineOffset: block.lineOffset,
							}
						);
					}
				} catch (e) {
					throw e;
				}
			},
		}))
		.value();
	// }}}

	return new Promise((resolve, reject) => {
		gulp.src(files, settings.src)
			.pipe(blockHead(_.pick(settings, ['default', 'blocks'])))
			.on('data', ()=> {}) // BUGFIX: Have to set data as a noop or 'end' doesnt get called - https://github.com/gulpjs/gulp/issues/1637
			.on('end', resolve)
			.on('error', reject)
	});
};

module.exports = blockHead;
module.exports.import = blockHeadImport;
