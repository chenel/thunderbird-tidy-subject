// Paste THIS ONE LINE as the FiltaQuilla "JavaScript Action" value.
// Everything else lives in tidy-subject.js on disk.
// Adjust the path. Note loadSubScript caches by URL; restart Thunderbird
// after editing, or use loadSubScriptWithOptions with ignoreCache: true.
Services.scriptloader.loadSubScript('file:///home/you/bin/tidy-subject.js', this);
