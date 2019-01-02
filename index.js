var _ = require('lodash');
var debug = require('debug')('block-head');
var parseAttributes = require('parse-attributes');
var through = require('through2');
var Vinyl = require('vinyl');

module.exports = function(options) {
	var settings = {
		default: false,
		blocks: {},
		...options,
	};

	if (_.isObject(settings.blocks)) { // Flatten lookup object into an array
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
			var blockStart; // The line offset the block started at
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
						blockStart = lineNumber + 1;
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
									lines.slice(blockStart, lineNumber).join('\n'),
									file.path,
									block
								) || ''
							),
							stat: file.stat,
						});

						foundBlocks.push({
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
				foundBlocks
					.sort((a, b) => a.sort == b.sort ? 0 : a.sort > b.sort ? 1 : -1)
					.forEach(block => {
						debug(`extracted file "${block.vinyl.path}" (${Math.ceil(block.vinyl.contents.length / 1024)}kb)`);
						this.push(block.vinyl);
					})

				done(); // Remove input content
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
			done(null, file);
		} else if (file.isStream()) {
			done('Gulp-block-head - Streams are not yet supported');
		} else {
			done('Unknown format');
		}
	});
};
