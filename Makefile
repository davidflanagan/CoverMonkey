CoverMonkey: src/coverage.js src/NodeApp.js
	rm -f CoverMonkey
	echo '#!/usr/bin/env node' >> CoverMonkey
	cat LICENSE >> CoverMonkey
	cat src/coverage.js >> CoverMonkey
	cat src/NodeApp.js >> CoverMonkey
	chmod 555 CoverMonkey

