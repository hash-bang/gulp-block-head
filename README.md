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


API
===
This plugin exports a single Gulp / Vinyl compatible stream transformer accepting a settings object.


Each block definition accepts the following properties:

| Key                    | Type                  | Default                                            | Description                                      |
|------------------------|-----------------------|----------------------------------------------------|--------------------------------------------------|
| `blocks`               | `Array` or `Object`   | `{}`                                               | Definition of the blocks                         |
| `blocks.[].id`         | `String`              | (derived from object key)                          | The ID of the block                              |
| `blocks.[].name`       | `Function`            | <code>(path, block) => `${path}#${block.id}</code> | How to name the output file                      |
| `blocks.[].transform`  | `Function`            | <code>(contents, path) => contents</code>          | How to transform the contents of the output file |
| `blocks.[].matchStart` | `RegExp`              | `/^<${block.id}>$/`                                | The matching start of the block                  |
| `blocks.[].matchEnd`   | `RegExp`              | `/^<\/${block.id}>$/`                              | The matching end of the block                    |
| `blocks.[].sort`       | `Function` or any     | `0`                                                | Where to output this block, if this is a function its called as `(path, block)` |
| `default`              | `Boolean` or `Object` | `false`                                            | Whether to handle files when no blocks are found |
| `default.name`         | `Function`            |                                                    | Optional renamer for default resources           |
| `default.transform`    | `Function`            |                                                    | Optional transformer for default resources       |
| `default.include`      | `Function`            | <code>(path) => true</code>                        | Determine whether to use the file in the output. If false no more processing is done. Applies only to the `default` block |


**Notes:**

* The `blocks` definitions can be in the form of an object or an array
* The `default` ID is used when no matches are found within the file
* A decision whether the file output should be included at all can be set with the `include` function within the default block
* The `path` parameter within `name` and `transform` functions is the original path of the file, not the rewritten one
