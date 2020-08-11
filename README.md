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

## Testing

To run the test suite, assuming you have installed and built the project using
the steps above, you can invoke karma with:

```shell
npm run test
```

This will also require a web-browser to be installed on your system. It will
start that browser and automatically run every test script found in the `test`
directory.

These tests are written with [Jasmine](https://jasmine.github.io/index.html).
This is a behavior-driven testing framework for JavaScript.

You can alternatively start a server and use your own web browser to see the
running test suite. This can offer a chance to debug the tests and the code
more naturally. To do so, you will start the test suite in its active mode:

```
npm run test-server
```

After it starts, it will report the port it is running on. It will say something
like `open http://localhost:9876/`, which is the moment you can open that URL
in your local web-browser.

### Filtering Tests

To run only specific tests, edit a test file and replace the word `describe` or `it` with `fdescribe` and/or `fit` respectively.
Then run the test suite as specified in the previous section.

One useful method of writing the tests is to start a test server that automatically runs new content.
Start a karma server using this command:

```
npm run test-server
```

Or alternatively:

```
npx karma start --auto-watch --no-single-run
```

This will run the tests when it sees any test file get written to, which allow you to implement tests incrementally.
