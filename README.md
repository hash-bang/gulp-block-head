gulp-block-head
===============
Simple, fast tool to filter [Single-File-Component](https://vuejs.org/v2/guide/single-file-components.html) style files into separate components.

This component was written out of frustration at the number of SFC supporting tools out there, none of which were simple, fast and unopinionated.


```javascript
var blockHead = require('gulp-block-head');
var gulp = require('gulp');

gulp('./**/*.vue')
	.pipe(blockHead({
		// Wrap JS contents in Vue.component
		js: contents => `Vue.component(${contents});`, 

		// Split CSS into its own file with a header
		css: {
			contents => `My CSS file\n${contents}`,
			name: (path, block) => `${path}.css`, // Append '.css' to end of input file name (e.g. myComponent.vue -> myComponent.vue.css)
		},
	}))
```


Tradeoffs
---------
Since this module is designed to be fast and unopinionated some tradeoffs with processing have to be made:

* File input is treated as lines, opening or closing block definitions are not supported
* The remainder of the matching opening or closing block is discarded - block points must be on lines by themselves
* By default any block items need to the very first things on their lines - putting a closing block mid-line will be ignored

The idea here is that we don't waste time throwing source code though gigantic XML processors to detect opening and closing sections. We just parse the files and splice the bits we're interested in.


Debugging
---------
This module uses the [debug](https://github.com/visionmedia/debug) module. Simply set `DEBUG=block-head` (or any other compatible inclusion expression) to show output.

```
DEBUG=block-head gulp build
```


Examples
--------
Given a `.vue` file that looks like this:

```
<service singleton option="value">
module.exports = { ... };
</service>

<component>
module.exports = {
	methods: {
		doSomething() {
			// ...
		}
	},
};
</component>

<template>
	<div class="card">
		<div class="card-header">
			<h2>Test unit</h2>
		</div>
		<div class="card-body">
			Hello World
		</div>
	</div>
</div>
```

You can split the above .vue file using a config such as:


```javascript
gulp.task('build.vue', ['load:app'], ()=>
	gulp.src([
		'**/*.vue',
		'!dist/**/*', // Don't get stuck in a loop
		'!node_modules/**/*',
	])
	.pipe(sourcemaps.init())
	.pipe(blockHead({
		blocks: {
			component: { // Accept something that should be registered via Vue.component()
				sort: 9, // Add after templates
				name: path => `components/${fspath.basename(path, '.vue')}.js`,
				transform: (content, path) =>
					`Vue.component('${fspath.basename(path, '.vue')}', `
					+ _.trimEnd(content, ';')
						.replace('{', `{\n\ttemplate: Vue.template('${fspath.basename(path, '.vue')}'),`)
					+ ')'
			},
			service: { // Accept some code to store as a shared service
				sort: 1,
				name: path => `services/${fspath.basename(path, '.vue')}.js`,
				transform: (content, path, block) => // Pass all attrs as arguments to the Vue.service() handler
					_.isEmpty(block.attr)
					? `Vue.service('${fspath.basename(path, '.vue')}', ${_.trimEnd(content, ';')});`
					: `Vue.service('${fspath.basename(path, '.vue')}', ${_.trimEnd(content, ';')}, ${JSON.stringify(block.attr)});`
			},
			script: { // Just dump the code inline
				sort: 0,
				name: path => `scripts/${fspath.basename(path, '.vue')}.js`,
				transform: content => content,
			},
			template: { // Wrap the HTML in a call to `Vue.template(id, html)`
				sort: 5,
				name: path => `templates/${fspath.basename(path, '.vue')}.js`,
				transform: (content, path) => `Vue.template('${fspath.basename(path, '.vue')}', \`${_.trimEnd(content, ';').replace(/\`/g, '\\`')}\`);`,
			},
		},
	}))
	.pipe(replace(/\s*module.exports =\s*/, '')) // Remove syntactic sugar
	.pipe(babel({
		presets: ['@babel/env'],
	}))
	.pipe(concat('app.js'))
	.pipe(uglify())
	.pipe(sourcemaps.write('.'))
	.pipe(gulp.dest('./dist'))
```

**Notes:**

* In the above we assume that `Vue.template(id, [html])` exists and provides a simple caching template store. You could alternatively dump your HTML into seperate files and deal with it that way
* Likewise `Vue.service(id, [object], [settings])` provides a caching service for objects, with additional options. Options are provided within a tag as attributes



API
===
This plugin exports a single Gulp / Vinyl compatible stream transformer accepting a settings object.


Each block definition accepts the following properties:

| Key                    | Type                    | Default                                            | Description                                      |
|------------------------|-------------------------|----------------------------------------------------|--------------------------------------------------|
| `blocks`               | `Array` or `Object`     | `{}`                                               | Definition of the blocks                         |
| `blocks.[].id`         | `String`                | (derived from object key)                          | The ID of the block                              |
| `blocks.[].ignore`     | `function` or `boolean` | `false`                                            | Whether to ignore the block entirely, if this is a function its called as `(path, block)` |
| `blocks.[].name`       | `Function`              | <code>(path, block) => `${path}#${block.id}</code> | How to name the output file                      |
| `blocks.[].transform`  | `Function`              | <code>(contents, path, block) => contents</code>   | How to transform the contents of the output file |
| `blocks.[].matchStart` | `RegExp`                | ``^<${block.id}(\s*.+?\s*)?>$``                    | The matching start of the block                  |
| `blocks.[].matchEnd`   | `RegExp`                | `/^<\/${block.id}>$/`                              | The matching end of the block                    |
| `blocks.[].sort`       | `Function` or any       | `0`                                                | Where to output this block, if this is a function its called as `(path, block)` |
| `default`              | `Boolean` or `Object`   | `false`                                            | Whether to handle files when no blocks are found |
| `default.name`         | `Function`              |                                                    | Optional renamer for default resources           |
| `default.transform`    | `Function`              |                                                    | Optional transformer for default resources       |
| `default.include`      | `Function`              | <code>(path) => true</code>                        | Determine whether to use the file in the output. If false no more processing is done. Applies only to the `default` block |


**Notes:**

* The `blocks` definitions can be in the form of an object or an array
* The `default` ID is used when no matches are found within the file
* A decision whether the file output should be included at all can be set with the `include` function within the default block
* The `path` parameter within `name` and `transform` functions is the original path of the file, not the rewritten one
* Tag attributes are available as `block.attr`. Single attributes default to true: `<block attr1 attr2="value2">` becomes `{attr1: true, attr2: 'value2'}`


BlockHead.import(files, options)
--------------------------------
In addition to a Gulp adpater this module also provides the shorthand `import()` method which allows inline inclusion of JS files split into blocks.

This function will attempt to read then given files (which can be a single path, array or any valid `gulp.src()` glob), extract the given blocks and run them with a context. This is designed to be as close as possible to the `import` syntax.


```javascript
var blockHead = require('gulp-block-head');


// Read the given HTML file and run all scripts specified in the 'script' blocks - this will execute in the current context
blockHead.import('./test/data/script.html', 'script')
	.then(()=> ...)


// Read the given HTML file and run all scripts specified in the 'script', 'include' and 'import' blocks - passing in a custom sandbox context
blockHead.import('./test/data/script.html', {
	blocks: ['script', 'include', 'import'],
	sandbox: {foo: 'Foo!'},
})
	.then(()=> ...)
```


This function supports the following options:

| Key       | Type                          | Default     | Description                                                                    |
|-----------|-------------------------------|-------------|--------------------------------------------------------------------------------|
| `blocks`  | `String`, `Array` or `Object` | `"backend"` | The blocks to process, see the notes below for more details                    |
| `src`     | `Object`                      | `{}`        | Options to pass to `gulp.src()` when processing the file input                 |
| `sandbox` | `Boolean` or `Object`         | `false`     | The sandbox to run the code in, if boolean `false` the current context is used |

**Notes:**

* If `blocks` is a single string or array of strings the transform function is constructed automatically, if its an object the transform is ignored and a full BlockHead spec must be specified instead
* If `sandbox === false` the script will have access to all objects in the current scope, including any declared globals
* Passing a single string or array to the `options` parameter will assume setting of the `blocks` property
