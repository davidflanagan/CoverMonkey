//
// Copyright (c) 2011 The Mozilla Foundation.
// All rights reserved.
// 
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//     Redistributions of source code must retain the above copyright
//     notice, this list of conditions and the following disclaimer.
//
//     Redistributions in binary form must reproduce the above copyright
//     notice, this list of conditions and the following disclaimer in the
//     documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
// IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
// TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
// PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
// TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
// PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
// LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
// NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
// Contributor(s): David Flanagan (dflanagan@mozilla.com)
//                 Donovan Preston (dpreston@mozilla.com)
//

// This class represents parsed code coverage data.
// Pass data (as a string in -D format) to the parseData() method.
// Access the parsed data through the data property. 
// You can call parseData() multiple times, and the data will be 
// updated with the most recent data.
//
// Or, pass a newFile callback that will be invoked for each new script/file
// in the coverage data.  And pass a lineUpdate callback; it will be invoked
// each time an line in an existing file gets a new count.  (I don't think
// that new lines will ever be added to an existing file, so lines should
// only ever have count updates) 
//
// XXX: do I do a lineUpdate for every line in a new file?
// When there are line updates, how do I update the overall coverage data
// for the file?  Do I just call the file callback again?
//
// Should the class have methods for getting coverage stats for a
// file?  Cedric thinks it could be nice to be able to add extra
// properties to line data, for example... So for the lines of a file,
// I should probably just return an array of objects...
// 
// Output format: an array of per-file data
//
// [{
//     filename: "foo.js"
//     covered: 100
//     partial: 50
//     uncovered: 25
//     dead: 0
//     lines: [{
//                 linenum: 101
//                 coverage: "full"|"some"|"none"|"dead"
//                 counts: [0,3]
//              },...]
//   }...]
//

function Coverage() {
    this.data = [];
    this._listeners = [];
    this.filenames = {};  // Map filenames to Coverage.File objects
}

Coverage.prototype.addListener = function(l) {
    this._listeners.push(l);
};

Coverage.prototype.removeListener = function(l) {
    var idx = this._listeners.indexOf(l);
    if (idx !== -1)
        this._listeners.splice(idx, 1);
};

Coverage.prototype._trigger = function(name /*, ... */) {
    var type = name;  // the type of event
    var self = this;
    var args = Array.prototype.slice.call(arguments, 1);
    args.unshift(this);

    this._listeners.forEach(function(l) {
        if (type in l) {
            l[type].apply(l, args);
        }
    });
};

Coverage.prototype.parseData = function(rawdata) {
    var self = this; // for nested functions
    var parser = new Coverage.Parser();
    var lines = rawdata.split("\n")
    lines.forEach(function(line) { parser.processLine(line); });
    var scripts = parser.scripts;

    // Convert the array of Script objects to an object mapping filenames
    // to File objects

    var files = {};  // Map filenames to Coverage.File objects
    scripts.forEach(function(script) {
        var filename = script.filename;
        if (!(filename in files)) {
            files[filename] = new Coverage.File(filename);
        }
        var file = files[filename];

        script.opcodes.forEach(function(opcode) {
            file.line(opcode.srcline).addOpcode(script.name + ":" + opcode.pc,
                                                opcode);
        });

        // The first and last opcodes of each script should correspond
        // (roughly) to the first and last lines of a function. Mark them
        // to indicate this.
        file.line(script.opcodes[0].srcline).startFunc = true;
        file.line(script.opcodes[script.opcodes.length-1].srcline).endFunc=true;
    });

    // Deal with the files in alphabetical order
    var filenames = [];
    for(var filename in files) filenames.push(filename);
    filenames.sort();
    
    filenames.forEach(function(filename) {
        var file = files[filename];
        var coverage = file.coverage();
        var filedata = {
            filename: filename,
            covered: coverage[0],
            partial: coverage[1],
            uncovered: coverage[2],
            dead: coverage[3],
            lines: []
        };

        for(var linenum in file.lines) {
            var line = file.lines[linenum];
            var l = {};
            linenum = Number(linenum);
            // XXX: convert to numeric constants?
            l.coverage = line.coverage();
            // XXX: cedric wants interpreted vs. jitted counts, but
            // these are one or more counts for lines with branches
            l.counts = line.counts();
            if (line.startFunc) l.startFunc = true;
            if (line.endFunc) l.endFunc = true;
            // Subtract 1 so that array index corresponds to the index
            // into an array of lines in a file.
            filedata.lines[linenum-1] = l;
        }

        if (!(filename in self.filenames)) {
            self.filenames[filename] = filedata;
            self._trigger("onNewScript", filename, filedata);
        }
        else {
            // Otherwise, we already have a data object for this file,
            // so update it from the new data
            var olddata = self.filenames[filename];

/*
            // If any of the file's overall coverage stats have changed
            // copy the new data into the old filedata object and trigger
            // the onScriptUpdate callback
            if (olddata.covered !== filedata.covered ||
                olddata.partial !== filedata.partial ||
                olddata.uncovered !== filedata.uncovered ||
                olddata.dead !== filedata.dead) {

                olddata.covered = filedata.covered;
                olddata.partial = filedata.partial;
                olddata.uncovered = filedata.uncovered;
                olddata.dead = filedata.dead;
                self._trigger("onScriptUpdate", filename, olddata);
            }

*/
            // Now look through the lines arrays and trigger onLineUpdate
            // for any lines whose counts have changed.

            // We expect that we'll get exactly the same set of lines
            // on every call to parseData()
            // XXX: actually, in the browser, separate scripts in 
            // the same file may be compiled at different times, apparently
            // assert(filedata.lines.length === olddata.lines.length)

            function equalArrays(a,b) {
                if (a.length !== b.length) return false;
                for(var i = 0, n = a.length; i < n; i++) {
                    if (a[i] !== b[i]) return false;
                }
                return true;
            }

            for(var i = 0; i < filedata.lines.length; i++) {
                if (!(i in filedata.lines)) continue;
                var newline = filedata.lines[i];
                var oldline = olddata.lines[i];

                if (!oldline) {
                    olddata.lines[i] = newline;
                    // Add one to the line number to get back to
                    // one-based line numbers
                    self._trigger("onLineUpdate", filename, i+1, newline);
                }

                if (newline.coverage !== oldline.coverage ||
                    !equalArrays(newline.counts, oldline.counts)) {
                    oldline.coverage = newline.coverage;
                    oldline.counts = newline.counts;
                    self._trigger("onLineUpdate", filename, i, oldline);
                }
            }

            // Now see if overall coverage for the file has changed, and
            // if so call the onScriptUpdate callback.  I can't use the
            // coverage stats in the filedata object because scripts
            // could have been garbage collected and can disappear from
            // the dumps!  (Trigger dumps before every script GC?)
            var oldcovered = olddata.covered;
            var oldpartial = olddata.partial;
            var olduncovered = olddata.uncovered;
            var olddead = olddata.dead;
            var newcovered = 0, newpartial = 0, newuncovered = 0, newdead = 0;

            for(var i = 0; i < olddata.lines.length; i++) {
                if (!(i in olddata.lines)) continue;
                var l = olddata.lines[i];
                switch(l.coverage) {
                case "full":
                    newcovered++;
                    break;
                case "some":
                    newpartial++;
                    break;
                case "none":
                    newuncovered++;
                    break;
                case "dead":
                    newdead++;
                    break;
                }
            }

            if (newcovered !== oldcovered ||
                newpartial !== oldpartial ||
                newuncovered !== olduncovered ||
                newdead !== olddead) {
                olddata.covered = newcovered;
                olddata.partial = newpartial;
                olddata.uncovered = newuncovered;
                olddata.dead = newdead;
                self._trigger("onScriptUpdate", filename, olddata);
            }
        }
    });
};

Coverage.SCRIPT_START = /^--- SCRIPT (.*):(\d+) ---$/;
Coverage.SCRIPT_END = /^--- END SCRIPT/;
Coverage.SCRIPT_DATA = /^(\d+):(\d+(?:\/\d+)+)\s+x\s+(\d+)\s+(.*)$/;

// Parse a series of data lines to build up an array of Script objects
Coverage.Parser = (function() {
    function Parser(remap) {
        this.inscript = false;
        this.scriptlines = null;
        this.scripts = [];   // Array of Script objects that hold the data
        this.scriptMap = {}; // String->Script map for detecting duplicate scripts
        this.remap = remap;  // Option function for remapping file/line
    };

    // process a single line.  Return true if we consumed it; false otherwise
    Parser.prototype.processLine = function(dataline) {
        if (this.inscript) {
            this.scriptlines.push(dataline);
            if (dataline.match(Coverage.SCRIPT_END)) {
                // Skip initial dummy script and any -e scripts
                if (this.scriptlines[0] !== "--- SCRIPT (null):0 ---" &&
                    this.scriptlines[0] !== "--- SCRIPT :0 ---" &&
                    this.scriptlines[0] !== "--- SCRIPT -e:1 ---") {
                    var script = new Coverage.Script(this.scriptlines,
                                                     this.remap);
                    var string = script.toString();
                    
                    var existingScript = this.scriptMap[string];
                    if (existingScript) {
                        // We've seen this script before
                        existingScript.addCounts(script);
                    }
                    else {
                        script.checkReachability();
                        this.scripts.push(script);
                        this.scriptMap[string] = script;
                    }
                }
                
                this.scriptlines = null;
                this.inscript = false;
            }
            return true;
        }
        else {
            if (dataline.match(Coverage.SCRIPT_START)) {
                this.inscript = true;
                this.scriptlines = [ dataline ];
                return true;
            }
            return false;
        }
    }
    return Parser;
}());

Coverage.Script = (function() {
    /*
     * Parse an array of lines to create a Script object.
     * "Script" is used in the SpiderMonkey internals sense: it is the body
     * of a JS function or the JS toplevel code, or an eval string.
     * 
     * Scripts have a name which is a (hopefully) unique id that includes the
     * source filename and starting line number. That isn't enough to be unique
     * because in "function a() { function b() {}}" both scripts have the same
     * file and line number. So I also have to include the ending line number
     * and/or ending opcode in the script name.  I could also include some kind
     * of hashcode of the script's opcodes in the name.  Or just use the
     * entire script disassembly as the name, I suppose.
     * 
     * XXX: Am I ever going
     * to be able to disambiguate functions a and b in the following, though?
     *   function() { function a(){} function b(){} }
     * 
     * Scripts also have a filename property that gives their filename
     * 
     * In addition to their name, scripts also have an array of opcodes and
     * a map of pc addresses to opcode indexes.
     *
     * Finally, each script has an entry point: the index of the starting opcode.
     * 
     * Each opcode includes its string of assembly code.  
     * And, after the script is analyzed, each opcode will also have a
     * reachable flag to indicate if it can ever actually be executed.
     */
    function Script(lines, remap) {
        var script = this;
        script.opcodes = [];
        script.pcToOpcodeIndex = {};
        script.remap = remap;

        lines.forEach(function(dataline) {
            var match;
            var file, line, virtual;

            if (match = dataline.match(Coverage.SCRIPT_START)) {
                file = match[1];
                line = parseInt(match[2], 10);
                if (script.remap) {
                    script.rawfilename = file;
                    virtual = script.remap(file, line);
                    file = virtual[0];
                    line = virtual[1];
                }
                script.filename = file; 
                script.startline = line
                script.name = file + ":" + line;
            }
            else if (dataline.match(Coverage.SCRIPT_END)) {
                return;
            }
            else if (dataline === "main:") {
                script.entrypoint = script.opcodes.length;
            }
            else if (match = dataline.match(Coverage.SCRIPT_DATA)) {
                line = parseInt(match[3], 10);
                if (script.remap) {
                    virtual = script.remap(script.rawfilename, line);
                    line = virtual[1];
                }

                // The counts field used to have 3 counts and this was
                // hardcoded. Now it has 6, but only the first 3 are real
                // counts. I've changed the regexp to allow any number.
                // But the code below assumes that there are at least 3.
                // Hopefully the -D output will stabilize...
                var counts = match[2].split('/');

                var opcode = {
                    pc: parseInt(match[1], 10),
                    count: parseInt(counts[0], 10) +
                        parseInt(counts[1], 10) +
                        parseInt(counts[2], 10),
                    srcline: line, 
                    assembly: match[4]
                };

                // Discard the (potentially very long) anonymous function 
                // souce associated with lambda opcodes
                if (opcode.assembly.match(/^lambda /))
                    opcode.assembly = "lambda";
                if (opcode.assembly.match(/^deflocalfun /))
                    opcode.assembly = "deflocalfun";

                script.pcToOpcodeIndex[opcode.pc] = script.opcodes.length;
                script.opcodes.push(opcode);
            }
            else if (dataline[0] === '\t') {
                // this is part of a switch (or other?) disassembly
                // for the previous opcode, so append it there
                script.opcodes[script.opcodes.length-1].assembly += dataline;
            }
            else {
                // Just ignore lines that we don't recognize.
                // We have to do this because some opcodes like lambda and
                // deflocalfun print out long function bodies on multiple lines
                return;
            }
        });
    }

    // Return a verbose representation of a script.  Distinct scripts will
    // always return distinct strings. (Except in the case of identical functions
    // on the same source line.)
    Script.prototype.toString = function() {
        var s = this.name + ":" + this.entrypoint + "\n";
        var ops = this.opcodes.map(function(opcode) {
            return opcode.pc + ":" + opcode.srcline + ":"+ opcode.assembly;
        });
        return s + ops.join("\n");
    }


    // Add the opcode counts from that script to the opcodes in this script.
    // This method requires that this.equals(that)
    Script.prototype.addCounts = function(that) {
        for(var i = 0; i < this.opcodes.length; i++)
            this.opcodes[i].count += that.opcodes[i].count;
    };

    var switches = {
        "tableswitch":true,
        "lookupswitch":true,
        "tableswitchx":true,
        "lookupswitchx":true,

    };

    var terminators = {
        "stop": true,
        "return": true,
        "throw": true,
        "retrval":true,
        // treat retsub as a terminator because I treated gosub as a conditional
        "retsub":true
    };

    var unconditionals = {
        "goto": true,
        "gotox":true,
        "default":true,
        "defaultx":true, 
        "filter": true // E4X opcode: we'll probably never see it
    };

    var conditionals = {
        "ifeq": true,
        "ifeqx": true,
        "ifne": true,
        "ifnex": true,
        "or":true,
        "orx":true,
        "and":true,
        "andx":true,
        // Treat gosub as a conditional because when it
        // returns the following opcode is reachable
        "gosub":true,
        "gosubx":true,
        "case":true,   
        "casex":true,  
        "ifcantcalltop":true,
        // E4X opcode: we'll probably never see it
        "endfilter": true,

        // I treat the try opcode as a conditional as well even though it isn't
        // With my patched spidermonkey, -D outputs try opcodes with the offset
        // of the corresponding catch block, if there is one.  If the try
        // is reachable, then the catch block is reachable, too, and treating
        // it like a conditional jump is an easy way to handle it.  Note, 
        // however, that some try opcodes (like try/finally) won't have an
        // offset.  So if the offset is missing for any conditional, I'll just
        // treat it as if it falls through.
        "try": true,
    };

    // All opcodes that don't just go on to the next one
    var nonlinear = {};
    var p; for(p in terminators) nonlinear[p] = terminators[p];
    for(p in switches) nonlinear[p] = switches[p];
    for(p in conditionals) nonlinear[p] = conditionals[p];
    for(p in unconditionals) nonlinear[p] = unconditionals[p];

    function linear(op) { return !(op in nonlinear); }

    function reachable(script, opcodeIndex) {
        var opcode, op;
        opcode = script.opcodes[opcodeIndex];
        opcode.entrypoint = true; // execution can jump to here

        while(opcodeIndex < script.opcodes.length) {
            // If this opcode is already marked as reachable, then
            // we've already been here and we're done.
            if (opcode.reachable) return;
            
            // Mark this opcode as reachable.
            opcode.reachable = true;

            // Get the name of this opcode
            op = opcode.assembly.match(/(\w+)/)[1];

            // If this opcode is not a linear one, then break
            // of the loop and handle it in the code below
            if (!linear(op)) break;

            // Mark this opcode as a linear one
            opcode.fallsthrough = true;

            // And move on to the next opcode
            opcode = script.opcodes[++opcodeIndex];
        } 

        if (opcodeIndex >= script.opcodes.length) return;

        // Now the current opcode is non-linear, so recurse to
        // mark the opcodes that are reachable from it.  For
        // conditional branches, it will be the next opcode plus
        // the branch target.  For unconditional it will just be
        // the branch target.  For switches, there will be many.
        // And for things like stop, return and throw, there will
        // be no reachable opcodes.
        
        if (op in terminators) {
            // This opcode makes the script exit, so nothing is 
            // reachable from here.
            return;
        }
        else if (op in unconditionals) {
            // The unconditional jump target is reachable
            reachable(script, branchIndex(opcode.assembly));
        }
        else if (op in conditionals) {
            // The next opcode and the jump target are both reachable
            reachable(script, opcodeIndex+1);
            // If there is a branch address, then that is reachable, too.
            // (I have to test this since I'm treating try opcodes as
            // branches, and they don't always have offsets)
            var branch = branchIndex(opcode.assembly)
            if (branch) reachable(script, branch);
        }
        else if (op in switches) {
            // Multiple opcodes are reachable
            // The -D output for switches includes relative jump offsets
            // not absolute ones like those used by jumps

            // Each case is on its own line, starting with the 2nd line
            // The default offset is on the first line after the string "ffset"
            var cases = opcode.assembly.split("\t");

            var offset = parseInt(cases[0].match(/ffset (\d+)/)[1], 10);
            var absolute = opcode.pc + offset;
            var index = script.pcToOpcodeIndex[absolute];
            reachable(script, index);

            for(var i = 1; i < cases.length; i++) {
                offset = parseInt(cases[i].match(/: (\d+)$/)[1], 10);
                absolute = opcode.pc + offset;
                index = script.pcToOpcodeIndex[absolute];
                reachable(script, index);
            }
        }

        function branchIndex(assembly) {
            var match = assembly.match(/^\w+\s+(\d+)/);
            if (!match) return null;
            return script.pcToOpcodeIndex[match[1]];
        }
    }

    Script.prototype.checkReachability = function() {
        // Mark the entry point of the script as reachable, and
        // from there recursively determine what else is reachable.
        // Note that this code treats 0 as the entry point, even when
        // this.entrypoint is something else.  Before this.entrypoint
        // we get things like defvar opcodes that just fall through to the
        // entrypoint.  If we start at this.entrypoint then sometime we'll
        // have opcodes marked unreachable that we don't want marked that way.
        reachable(this, 0);
    };

    return Script;
}());

Coverage.File = (function() {
    function File(name) {
        this.name = name;
        this.lines = {};
    }

    File.prototype.line = function(linenum) {
        if (!this.lines[linenum]) {
            this.lines[linenum] = new Coverage.Line(this, linenum);
        }
        return this.lines[linenum];
    };

    File.prototype.coverage = function() {
        var covered = 0, partial = 0, uncovered = 0, dead = 0;

        for(var linenum in this.lines) {
            var line = this.lines[linenum];
            switch(line.coverage()) {
            case "full": covered++; break;
            case "some": partial++; break;
            case "none": uncovered++; break;
            case "dead": dead++; break;
            case "": // do nothing in this case
            }
        }

        return [covered, partial, uncovered, dead];
    };

    // Return the coverage class for line n of the specified file.
    // Lines that don't have executable code will return an empty string.
    File.prototype.coverageClass = function(n) {
        if (n in this.lines) 
            return " " + this.lines[n].coverage();
        return "";
    };

    // Return the profile class for line n.  This will be based on the 
    // base-10 logarithm of the number of executions
    File.prototype.profileClass = function(n) {
        if (!(n in this.lines)) return "";
        var counts = this.lines[n].counts();
        var count = counts[counts.length-1];  // the last one is biggest
        return " p" + log(count);

        function log(x) {
            if (x <= 0) return 0;
            return Math.min(Math.floor(Math.log(x)/Math.LN10), 9);
        }
    };

    return File;
}());

Coverage.Line = (function() {

    function Line(file, number) {
        this.file = file;
        this.number = number;
        this.opcodes = {};  // Map pc to Opcode object
    }

    Line.prototype.addOpcode = function(pc, opcode) {
        if (this.opcodes[pc]) {
            // XXX: reinstate this somehow?
            // console.log("Ignoring duplicate opcode");
            return;
        }
        this.opcodes[pc] = opcode;
    };

    // Return an array of the counts for this line.  If all opcodes have
    // the same count, then this will be a single element array.  If the line
    // includes a branch then there will be multiple elements.  The counts will
    // be sorted from fewest to most.
    // If all opcodes are unreachable, then the returned array will be empty
    // indicating that the line is dead code.
    // Unreachable opcodes have a count of -1
    Line.prototype.counts = function() {
        if (!this._counts) {
            var min = Infinity, max = 0;
            var rawcounts = [];
            var lastopcode;

            for(var pc in this.opcodes) {
                var opcode = this.opcodes[pc];
                var c = opcode.count;
                if (opcode.reachable) {

                    // If the last opcode continues unconditionally on to this 
                    // one then skip this opcode if the count is the same (it 
                    // might be different if this one is also a jump target).
                    // And also skip this opcode if it has a zero count and
                    // the last one did not: that is just the sign of an
                    // interpreter optimization that messes up the counts
                    if (lastopcode && lastopcode.fallsthrough &&
                        ((c === lastopcode.count) ||
                         (c === 0 && lastopcode.count !== 0))) {
                        // Skip this count, do nothing
                    }
                    else {
                        min = Math.min(min, c);
                        max = Math.max(max, c);
                        rawcounts.push(c);
                    }
                }
                else {  // Unreachable opcode
                    if (c !== 0) {
                        // XXX: reinstate this somehow?
                        // Do these warnings still occur?
                        // If so, deal with them?
                        // console.log("WARNING: unreachable opcode with non-0 count");
                        // console.log(pc, opcode.count, opcode.assembly);
                    }
                    
                    rawcounts.push(-1);
                }

                lastopcode = opcode;
            }

            var counts;

            
            if (min === max && min >=0) {      // Special case: all lines are same
                counts = [min];  
            }
            else if (rawcounts.length === 1 && rawcounts[0] === -1) {
                // A single unreachable opcode.  If it is a stop opcode, then
                // this isn't really a dead line and should be treated as an
                // insignificant line instead.
                if (this.opcodes[Object.keys(this.opcodes)[0]].assembly === "stop")
                    counts = [];
            }
            else {
                rawcounts.sort(function(a,b) { return a-b; });  // Numerical order
                
                // Remove duplicates so only the unique counts are listed here
                var counts = [];
                counts[0] = rawcounts[0];
                for(var i = 1, j = 0; i < rawcounts.length; i++) {
                    if (rawcounts[i] === counts[j]) continue;
                    counts[++j] = rawcounts[i];
                }
            }            
            this._counts = counts;
        }

        return this._counts;
    };

    // Return coverage for this line.
    // One of the strings "full", "some", "none", "dead" or ""
    Line.prototype.coverage = function() {
        var counts = this.counts();
        // We return "" if the code should be treated as insignificant code
        // like comments and whitespace.  This happens when there is a single
        // unreachable stop opcode
        if (counts.length === 0) return "";

        if (counts[0] > 0) return "full";
        if (counts.length === 1) {
            if (counts[0] === 0) return "none";
            if (counts[0] === -1) return "dead";
        }
        else {
            if (counts[0] === -1 && counts[1] > 0) return "full";
            return "some";
        }
    };

    return Line;
}());
