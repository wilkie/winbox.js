"use strict";

import Helper from '../helper.js';

import Memory from '../../src/emulator/memory.js';

describe('Memory', () => {
    beforeEach(function() {
    });

    describe('.constructor', () => {
        it('should create 8192 segments', function() {
            let memory = new Memory();
            expect(memory.segments.length).toEqual(8192);
        });

        it('should create empty segments', function() {
            let memory = new Memory();
            expect(memory.segments[0]).toBeUndefined();
        });
    });
});
