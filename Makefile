CoverMonkey: src/Coverage.js src/NodeApp.js
	rm -f CoverMonkey
	echo '#!/usr/bin/env node' >> CoverMonkey
	cat LICENSE >> CoverMonkey
	cat src/Coverage.js >> CoverMonkey
	cat src/NodeApp.js >> CoverMonkey
	chmod 555 CoverMonkey

