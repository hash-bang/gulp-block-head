var expect = require('chai').expect;
var blockHead = require('..');
var gulp = require('gulp');
var fspath = require('path');

describe('simple replacements', ()=> {

	it('should be able to perform simple replacements', done => {
		var output = {};
		gulp.src(`${__dirname}/data/simple.html`)
			.pipe(blockHead({
				foo: x => `foo>${x}<foo`, // Key => Transform
				bar: { // Extended definition
					transform: x => `bar>>${x}<<bar`,
				},
				baz: { // Transform + rename
					name: (path, block) => 'baz.txt',
					transform: x => `baz>>>${x}<<<baz`,
				},
			}))
			.on('data', d => {
				var base = fspath.basename(d.path);
				output[base] = output[base] ? output[base] + d.contents.toString() : d.contents.toString();
			})
			.on('end', ()=> {
				expect(output).to.deep.equal({
					'simple.html#foo': 'foo>\tFoo contents!<foo',
					'simple.html#bar': 'bar>>\tBar contents!\n\tBar contents 2!<<bar',
					'baz.txt': 'baz>>>\tBaz contents!\n\tBaz contents 2!\n\tBaz contents 3!<<<baz',
				});
				done();
			})
	});

});

describe('default rules', ()=> {

	it('should be able to assume defaults', done => {
		var output = {};
		gulp.src(`${__dirname}/data/default.js`)
			.pipe(blockHead({
				default: {
					name: (path, block) => path,
					transform: x => x,
				},
			}))
			.on('data', d => {
				var base = fspath.basename(d.path);
				output[base] = output[base] ? output[base] + d.contents.toString() : d.contents.toString();
			})
			.on('end', ()=> {
				expect(output).to.deep.equal({
					'default.js': 'alert(\'Hello World\');\n',
				});
				done();
			})
	});

	it('should be able accept inclusion', done => {
		var output = {};
		gulp.src(`${__dirname}/data/default.js`)
			.pipe(blockHead({
				default: {
					include: path => true,
				},
			}))
			.on('data', d => {
				var base = fspath.basename(d.path);
				output[base] = output[base] ? output[base] + d.contents.toString() : d.contents.toString();
			})
			.on('end', ()=> {
				expect(output).to.not.deep.equal({});
				done();
			})
	});

	it('should be able refuse inclusion', done => {
		var output = {};
		gulp.src(`${__dirname}/data/default.js`)
			.pipe(blockHead({
				default: {
					include: path => false,
				},
			}))
			.on('data', d => {
				var base = fspath.basename(d.path);
				output[base] = output[base] ? output[base] + d.contents.toString() : d.contents.toString();
			})
			.on('end', ()=> {
				expect(output).to.deep.equal({});
				done();
			})
	});

});
