var _ = require('lodash');
var debug = require('debug')('block-head');
var through = require('through2');
var Vinyl = require('vinyl');

module.exports = function(blocks) {
	if (_.isObject(blocks)) { // Flatten lookup object into an array
		blocks = Object.keys(blocks).map(id => {
			var block =
				_.isFunction(blocks[id]) ? {transform: blocks[id]} // Shorthand definition
				: blocks[id];

			block.id = id;
			return block;
		});
	}

	// Error check the blocks
	blocks = blocks.map(block => ({
		matchStart: new RegExp(`^<${block.id}>$`),
		matchEnd: new RegExp(`^</${block.id}>$`),
		transform: contents => contents,
		name: (path, block) => `${path}#${block.id}`,
		...block,
	}))


	return through.obj(function(file, enc, done) {
		var foundBlocks = 0;
		var stream = this;

		if (file.isBuffer()) {
			var lines = file.contents.toString().split('\n');
			var activeBlock = false; // Either boolean false or the block reference we are in
			var blockStart; // The line offset the block started at

			lines.forEach((line, lineNumber) => {
				if (!activeBlock) { // Not yet in a block
					activeBlock = blocks.find(b => b.matchStart.test(line));
					if (activeBlock) { // Start of a new block
						blockStart = lineNumber + 1;
					}
				} else if (activeBlock.matchEnd.test(line)) { // End of a block
					var vObject = {
						path: activeBlock.name(file.path, activeBlock),
						contents: new Buffer.from(
							activeBlock.transform(
								lines.slice(blockStart, lineNumber).join('\n'),
								file.path
							)
						),
						stat: file.stat,
					};

					debug(`extracted file "${vObject.path}" (${Math.ceil(vObject.contents.length / 1024)}kb)`);

					stream.push(new Vinyl(vObject))
					foundBlocks++;
					activeBlock = false;
				}
			});

			var defaultBlock = blocks.find(b => b.id == 'default');
			if (foundBlocks == 0 && defaultBlock) { // No blocks extracted and we have a definition for a default
				var vObject = {
					path: defaultBlock.name(file.path, defaultBlock),
					contents: new Buffer.from(
						defaultBlock.transform(file.contents.toString(), file.path)
					),
					stat: file.stat,
				};

				debug(`extracted default file "${vObject.path}" (${Math.ceil(vObject.contents.length / 1024)}kb)`);

				stream.push(new Vinyl(vObject))
				done();
			} else {
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