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
										line: block.lineOffset + 1, // Offsets are usually zero based
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
				expect(err.stack).to.match(/\s*at .*?\/scripts-error.html:6:7\n/);
				done();
			})
	});

});
