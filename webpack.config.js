const webpack = require('webpack');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const OptimizeCssAssetsPlugin = require("optimize-css-assets-webpack-plugin");
const TerserJsPlugin = require('terser-webpack-plugin');

/* This describes the behavior of webpack.
 */
module.exports = {
  /* The main javascript file for the application
   */
  entry: {
    "winbox": ["./src/shim.js", "./css/main.scss"],
    vendor: ["./src/vendor.js", "./css/vendor.scss"],
  },

  /* Just... ignore this for now.
   */
  performance: {
    hints: false
  },

  /* The default mode.
   */
  mode: "production",

  /* The eventual transpiled output file.
   */
  output: {
    path: __dirname + "/dist",
    filename: "[name].js",
    sourceMapFilename: "[name].js.map"
  },

  /* We want source maps!
   */
  devtool: "source-map",

  /* What file types to filter.
   */
  resolve: {
    extensions: ['.js', '.css', '.scss']
  },

  /* How to load/import modules (for each file).
   */
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /(node_modules|bower_components)/,
        use: [
          "babel-loader",
          "eslint-loader",
        ]
      },
      {
        test: /\.(sa|sc|c)ss$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
          },
          "css-loader",
          "sass-loader"
        ]
      }
    ]
  },

  /* Minimize all vendored css */
  optimization: {
    minimizer: [
      new OptimizeCssAssetsPlugin({}),
      new TerserJsPlugin()
    ]
  },

  /* What plugins to use.
   */
  plugins: [
    new MiniCssExtractPlugin({
      // Options similar to the same options in webpackOptions.output
      // both options are optional
      filename: "./css/[name].css",
      chunkFilename: "[id].css"
    }),
    //new webpack.HotModuleReplacementPlugin(),
  ]
}
