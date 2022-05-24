const fs = require('fs')
const path = require('path')
const webpack = require('webpack')
const autoprefixer = require('autoprefixer');
const CleanWebpackPlugin = require('clean-webpack-plugin')
const CopyPlugin = require('copy-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const ZipPlugin = require('zip-webpack-plugin')
const GenerateWidgetHash = require('./webpack-generate-widget-hash')
const nodeExternals = require("webpack-node-externals");
const ExtractTextPlugin = require("extract-text-webpack-plugin");
const postcssPresetEnv = require('postcss-preset-env');

// creators and players may reference materia core files directly
// To do so rather than hard-coding the actual location of those files
// the build process will replace those references with the current relative paths to those files
const packagedJSPath = 'src=\\"../../../js/$3\\"'
const devServerJSPath = 'src=\\"/mwdk/assets/js/$3\\"'
const replaceTarget = process.env.RUNNING_DEV_SERVER ? devServerJSPath : packagedJSPath

// common paths used here
const srcPath = path.join(process.cwd(), 'src') + path.sep
const outputPath = path.join(process.cwd(), 'build') + path.sep

// list of supported browsers for use in autoprefixer
const browserList = [
	'Explorer >= 11',
	'last 3 Chrome versions',
	'last 3 ChromeAndroid versions',
	'last 3 Android versions',
	'last 3 Firefox versions',
	'last 3 FirefoxAndroid versions',
	'last 3 iOS versions',
	'last 3 Safari versions',
	'last 3 Edge versions'
]

// when copying files, always ignore these
const copyIgnore = [
	'.gitkeep'
]

// regex rules needed for replacing scripts loaded from materia
const materiaJSReplacements = [
	{ search: /src=(\\?("|')?)(materia.enginecore.js)(\\?("|')?)/g,  replace: replaceTarget },
	{ search: /src=(\\?("|')?)(materia.scorecore.js)(\\?("|')?)/g,   replace: replaceTarget },
	{ search: /src=(\\?("|')?)(materia.creatorcore.js)(\\?("|')?)/g, replace: replaceTarget },
	{ search: /src=(\\?("|')?)(materia.scorecore.js)(\\?("|')?)/g,   replace: replaceTarget },
];

// webpack entries
const getDefaultEntries = () => ({
	'creator.js': [
		`${srcPath}creator.coffee`
	],
	'player.js': [
		`${srcPath}player.coffee`
	],
	'creator.css': [
		`${srcPath}creator.html`,
		`${srcPath}creator.scss`
	],
	'player.css': [
		`${srcPath}player.html`,
		`${srcPath}player.scss`
	]
})

// Load the materia configuration settings from the package.json file
const configFromPackage = () => {
	let packagePath  = path.join(process.cwd(), 'package.json')
	let packageJson  = require(packagePath)
	return {
		cleanName : packageJson.materia.cleanName.toLowerCase(),
	}
}

// list of files and directories to copy into widget
const getDefaultCopyList = () => {
	const copyList = [
		{
			flatten: true,
			from: `${srcPath}demo.json`,
			to: `${outputPath}demo.json`,
		},
		{
			flatten: true,
			from: `${srcPath}install.yaml`,
			to: outputPath,
		},
		{
			from: `${srcPath}_icons`,
			to: `${outputPath}img`,
			toType: 'dir'
		},
		{
			flatten: true,
			from: `${srcPath}_score`,
			to: `${outputPath}_score-modules`,
			toType: 'dir'
		},
		{
			from: `${srcPath}_screen-shots`,
			to: `${outputPath}img/screen-shots`,
			toType: 'dir'
		}
	]

	// assets directory is built in , but optional
	let assetsPath = `${srcPath}assets`
	if (fs.existsSync(assetsPath)) {
		copyList.push({
			from: assetsPath,
			to: `${outputPath}assets`,
			toType: 'dir'
		})
	}

	// optionally use demo_dev.json to replace demo.json
	// when running the dev server
	const devDemo = 'demo_dev.json'
	const devDemoPath = `${srcPath}${devDemo}`
	if (process.env.RUNNING_DEV_SERVER && fs.existsSync(devDemoPath)) {
		console.log(`===== USING ${devDemo} ====`)
		copyList.push({
			flatten: true,
			from: devDemoPath,
			to: `${outputPath}demo.json`,
			force: true
		})
	}

	return copyList
}

// Rules needed for common builds
const getDefaultRules = () => ({
	// process regular javascript files
	// SKIPS the default webpack Javascript functionality
	// that evaluates js code and processes module imports
	loaderDoNothingToJs: {
		test: /\.js$/i,
		exclude: /node_modules/,
		loader: ExtractTextPlugin.extract({
			use: ['raw-loader']
		})
	},
	// process coffee files by translating them to js
	// SKIPS the default webpack Javascript functionality
	// that evaluates js code and processes module imports
	loaderCompileCoffee: {
		test: /\.coffee$/i,
		exclude: /node_modules/,
		loader: ExtractTextPlugin.extract({
			use: [
				'raw-loader',
				{
					loader: 'coffee-loader',
					options: {
						transpile:{
							presets: [
								'@babel/preset-env'
							]
						}
					}
				}
			]
		})
	},
	// webpack is going to look at all the images, fonts, etc
	// in the src of the html files, this will tell webpack
	// how to deal with those files
	copyImages: {
		test: /\.(jpe?g|png|gif|svg)$/i,
		loader: 'file-loader',
		options: {
			emitFile: false,
			useRelativePath: true,
			name: '[name].[ext]',
		}
	},
	// Loads the html files and minifies their contents
	// Rewrites the paths to our materia core libs provided by materia server
	loadHTMLAndReplaceMateriaScripts: {
		test: /\.html$/i,
		exclude: /node_modules|_guides|guides/,
		use: [
			{
				loader: 'file-loader',
				options: { name: '[name].html' }
			},
			{
				loader: 'extract-loader'
			},
			{
				loader: 'string-replace-loader',
				options: { multiple: materiaJSReplacements }
			},
			'html-loader'
		]
	},
	// Process CSS Files
	// Adds autoprefixer
	loadAndPrefixCSS: {
		test: /\.css$/i,
		exclude: /node_modules/,
		loader: ExtractTextPlugin.extract({
			use: [
				'raw-loader',
				{
					// postcss-loader is needed to run autoprefixer
					loader: 'postcss-loader',
					options: {
						// add autoprefixer, tell it what to prefix
						plugins: [
							require('autoprefixer')({
								browsers: browserList
							})
						],
					}
				},
			]
		})
	},
	// Process SASS/SCSS Files
	// Adds autoprefixer
	loadAndPrefixSASS: {
		test: /\.s[ac]ss$/i,
		exclude: /node_modules\/(?!(materia-widget-development-kit\/templates)\/).*/,
		loader: ExtractTextPlugin.extract({
			use: [
				'raw-loader',
				{
					// postcss-loader is needed to run autoprefixer
					loader: 'postcss-loader',
					options: {
						// add autoprefixer, tell it what to prefix
						plugins: [
							require('autoprefixer')({
								browsers: browserList
							})
						],
					}
				},
				'sass-loader'
			]
		})
	},
	loadAndCompileMarkdown: {
		test: /\.md$/,
		exclude: /node_modules/,
		use: [
				{
					loader: 'file-loader',
					options: {
						name: '[name].html',
						outputPath: 'guides/'
					}
				},
				'extract-loader','html-loader','markdown-loader']
	}
})

// This is a base config for building legacy widgets
// It will skip webpack's javascript functionality
// to avoid having to make changes to the source code of those widgets
// the config argument allows you to override some settings
// you can update the return from this method to modify or alter
// the base configuration
const getLegacyWidgetBuildConfig = (config = {}) => {
	let materiaCleanName = configFromPackage().cleanName;

	let defaultRules = getDefaultRules();

	let build = {
		mode: process.env.NODE_ENV || 'production',
  	stats: {children: false},
		devServer: {
			static: outputPath,
			headers: {
				// allow iframes to talk to their parent containers
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
			},
			port: process.env.PORT || 8118,
		},
		// Creates a runtime file to be shared by all chunks
		// Needed since we have multiple entry points
		optimization: {
		  runtimeChunk: 'single',
		},

		// Use widget custom entry points
		// Else use the default js and css files
		entry: config.entries ? config.entries : getDefaultEntries(),

		// write files to the outputPath (default = ./build) using the object keys from 'entry' above
		output: {
			path: outputPath,
			filename: '[name]',
			publicPath: '',
		},
		// Ignore built-in modules like path, fs when bundling
		target: 'node',
		// Ignore node_modules when bundling
	  externals: [nodeExternals()],

		module: {
			// Use widget rules, else use default rules
			rules: config.moduleRules ? config.moduleRules : [
				defaultRules.loaderDoNothingToJs,
				defaultRules.loaderCompileCoffee,
				defaultRules.loadAndCompileMarkdown,
				defaultRules.loadHTMLAndReplaceMateriaScripts,
				defaultRules.copyImages,
				defaultRules.loadAndPrefixCSS,
				defaultRules.loadAndPrefixSASS
			]
		},
		plugins: [
			new CleanWebpackPlugin(),
			// copy all the common resources to the build directory
			new CopyPlugin(getDefaultCopyList().concat(config.copyList)),
			// extract css from the webpack output
			new ExtractTextPlugin({filename: '[name]'}),
			// zip everything in the build path to zip dir
			new ZipPlugin({
				path: `${outputPath}_output/`,
				filename: materiaCleanName,
				extension: 'wigt'
			}),
			new GenerateWidgetHash({
				widget: `_output/${materiaCleanName}.wigt`,
				output: `_output/${materiaCleanName}-build-info.yml`
			}),
		]
	}

	// conditionally add plugins to handle guides if the directory exists in /src
	if (fs.existsSync(`${srcPath}_guides`))
	{
		// attach the guideStyles css to the default entry, if used
		build.entry['guides/guideStyles.css'] = [
			'./node_modules/materia-widget-development-kit/templates/guideStyles.scss'
		]

		build.plugins.unshift(
			// explicitly remove the creator.temp.html and player.temp.html files created as part of the markdown conversion process
			new CleanWebpackPlugin({
				cleanAfterEveryBuildPatterns: [`${outputPath}guides/creator.temp.html`, `${outputPath}guides/player.temp.html`]
			})
		)

		// inject the compiled guides markdown into the templates and re-emit the guides
		if (fs.existsSync(`${srcPath}_guides/creator.md`))
		{
			build.plugins.push(
				new HtmlWebpackPlugin({
					template: './node_modules/materia-widget-development-kit/templates/guide-template',
					filename: 'guides/creator.html',
					htmlTitle: 'Widget Creator Guide'
				})
			)
		}
		if (fs.existsSync(`${srcPath}_guides/player.md`))
		{
			build.plugins.push(
				new HtmlWebpackPlugin({
					template: './node_modules/materia-widget-development-kit/templates/guide-template',
					filename: 'guides/player.html',
					htmlTitle: 'Widget Player Guide'
				})
			)
		}
	}
	else {
		console.warn("No helper docs found, skipping plugins")
	}

	return build
}

module.exports = {
	materiaJSReplacements: materiaJSReplacements,
	configFromPackage: configFromPackage,
	getLegacyWidgetBuildConfig: getLegacyWidgetBuildConfig,
	getDefaultRules: getDefaultRules,
	getDefaultCopyList: getDefaultCopyList,
	getDefaultEntries: getDefaultEntries
}
