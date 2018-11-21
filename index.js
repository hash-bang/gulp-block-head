var _ = require('lodash');
var debug = require('debug')('block-head');
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
		matchStart: new RegExp(`^<${block.id}>$`),
		matchEnd: new RegExp(`^</${block.id}>$`),
		transform: contents => contents,
		name: (path, block) => `${path}#${block.id}`,
		...block,
	}))


	return through.obj(function(file, enc, done) {
		var stream = this;

		if (file.isBuffer()) {
			var lines = file.contents.toString().split('\n');
			var block = false; // Either boolean false or the block reference we are in
			var blockStart; // The line offset the block started at
			var foundBlocks = [];

			lines.forEach((line, lineNumber) => {
				if (!block) { // Not yet in a block
					block = settings.blocks.find(b => b.matchStart.test(line));
					if (block) { // Start of a new block
						blockStart = lineNumber + 1;
					}
				} else if (block.matchEnd.test(line)) { // End of a block
					var vObject = {
						path: block.name(file.path, block),
						contents: new Buffer.from(
							block.transform(
								lines.slice(blockStart, lineNumber).join('\n'),
								file.path
							)
						),
						stat: file.stat,
					};

					foundBlocks.push({
						sort: block.sort ? block.sort(file.path, block) : 0,
						vinyl: vObject,
					});

					debug(`extracted file "${vObject.path}" (${Math.ceil(vObject.contents.length / 1024)}kb)`);
					block = false;
				}
			});

			if (foundBlocks.length) { // Found some blocks
				foundBlocks
					.sort((a, b) => a.sort == b.sort ? 0 : a.sort > b.sort ? 1 : -1)
					.forEach(block => this.push(block.vinyl))

				done(); // Remove input content
			} else if (typeof settings.default == 'object') { // No blocks extracted and we have a definition for a default
				if (settings.default.include) { // Check if we should include this at all
					if (!settings.default.include(file.path)) return done();
				}

				var vObject = {
					path: settings.default.name ? settings.default.name(file.path, settings.default) : file.path,
					contents: new Buffer.from(
						settings.default.transform
							?  settings.default.transform(file.contents.toString(), file.path)
							: file.contents
					),
					stat: file.stat,
				};

				debug(`extracted default file "${vObject.path}" (${Math.ceil(vObject.contents.length / 1024)}kb)`);

				stream.push(new Vinyl(vObject))
				done(); // Remove input content
			} else if (settings.default === false) { // Remove the file from the stream
				done(); // Remove input content
			} else { // Let the file pass though
				done(null, file);
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
