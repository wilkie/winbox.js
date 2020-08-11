# WinBox.js

This project is an ambitious clean-room implementation of the Windows 3.1 kernel
and userspace libraries. This provides an HTML-powered windowing engine that
mimics the Windows 3.1 interface to provide a preservation quality software
archival solution.

The goals are many but mainly focused around:

* High compatibility with many popular-in-their-time applications and games.
* Modern HTML accessibility, including support for screen-readers.
* Wrapping older win16 libraries and using them in your own modern web-applications.
* Support for building new, potentially anachronistic, pseudo-win16 applications using the 16-bit windows API.

## Development

To gather the dependencies for the project, you will first want to install `npm`
using your system's package manager. Once you have `npm`, you can install the
dependencies via:

```shell
npm install
```

This places those dependencies in a directory called `node_modules` which we
will generally ignore.

Then you will proceed to the next section to build the vendored libraries and
create a web bundle.

## Building

To build a web bundle, you can invoke npm like so:

```shell
npm run build
```

This will invoke webpack to use babel to transpile our JavaScript to a flavor
more acceptable to a wide range of web browsers. Although, our code will work
well in most modern browsers as is, and you may elect to use the native code
as you develop.

The webpack configuration is within `webpack.config.js`. It will generate
css files and JavaScript bundles in the `dist` directory. The `winbox.js`
file is the web bundle which is a single file that contains the entire source
for the entire project namespace. The `dist/css/winbox.css` contains the
entire css stylesheets that makes things look the way they do.

## Documentation

To create a web-based HTML version of the documentation, you can again use npm
to run the `documentation.js` program as so:

```shell
npm run build-docs
```

This creates an HTML document and associated files in the `docs` directory.
If you open the `index.html` file in your local web browser, you can access a
searchable version of the project documentation.

This documentation is all parsed from the comment blocks that start with a slash
and two asterisks (`/**`) and are all already accessible in the code themselves.
