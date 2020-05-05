var blockHead = require('..');
var expect = require('chai').expect;
var fspath = require('path');
var gulp = require('gulp');
var vm = require('vm');

describe('node execution', ()=> {

	it('should be able to extract code blocks and run them', done => {
		var sandbox = {
			output: [],
			outputMeta: {},
		};

		gulp.src(`${__dirname}/data/scripts.html`)
			.pipe(blockHead({
				blocks: {
					script: {
						name: path => path,
						transform: (content, path, block) => {
							vm.runInNewContext(
								content,
								Object.assign({}, sandbox, {
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
						},
					},
				},
			}))
			.on('finish', ()=> {
				expect(sandbox.output).to.deep.equal(['S1', 'S2', 'S3']);
				expect(sandbox.outputMeta).to.deep.equal({
					s1: {line: 2, file: 'scripts.html'},
					s2: {line: 7, file: 'scripts.html'},
					s3: {line: 13, file: 'scripts.html'},
				});
				done();
			})
	});

	it('should be able to extract code blocks and crash out with the correct filename / line', done => {
		var sandbox = {
			output: [],
		};
		var err; // Caught error

		gulp.src(`${__dirname}/data/scripts-error.html`)
			.pipe(blockHead({
				blocks: {
					script: {
						name: path => path,
						transform: (content, path, block) => {
							try {
								vm.runInNewContext(content, sandbox, {
									filename: path,
									lineOffset: block.lineOffset,
								});
							} catch (e) {
								err = e;
							}
						},
					},
				},
			}))
			.on('finish', ()=> {
				expect(sandbox.output).to.deep.equal(['S1']);

				expect(err).to.be.an('error');
				expect(err.message).to.match(/This is a silly error/);
				expect(err.stack).to.match(/\s*at .*?\/scripts-error.html:6:7/);
				done();
			})
	});

});

describe('blockHead.import()', ()=> {

	it('should import into sandboxed context', ()=> {
		var options = {
			blocks: ['script'],
			sandbox: {
				output: [],
				outputMeta: {},
				script: 'dummy.js',
			},
		};

		return blockHead.import(`${__dirname}/data/scripts.html`, options)
			.then(()=> {
				expect(options.sandbox.output).to.deep.equal(['S1', 'S2', 'S3']);
			});
	});

	it('should import into current context', ()=> {
		global.output = [];
		global.outputMeta = {};
		global.script = 'dummy.js';

		return blockHead.import(`${__dirname}/data/scripts.html`, 'script')
			.then(()=> {
				expect(global.output).to.deep.equal(['S1', 'S2', 'S3']);
			});
	});

	it('should support transform replacement', ()=> {
		var found = [];
		return blockHead.import(`${__dirname}/data/scripts.html`, {
			blocks: {
				script: {
					transform: (content, path, block) => {
						found.push({path, ...block.attr});
					},
				},
			},
		})
		.then(()=> {
			expect(found).to.deep.equal([
				{path: `${__dirname}/data/scripts.html`, attr1: 'value1'},
				{path: `${__dirname}/data/scripts.html`, attr2: 'value2'},
				{path: `${__dirname}/data/scripts.html`, attr1: 'value1', attr2: 'value2'},
			]);
		});
	});

});
