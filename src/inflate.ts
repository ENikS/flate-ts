///////////////////////////////////////////////////////////////////////////////
// Copyright (c) ENikS.  All rights reserved.
//
// Licensed under the Apache License, Version 2.0  ( the  "License" );  you may 
// not use this file except in compliance with the License.  You may  obtain  a 
// copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required  by  applicable  law  or  agreed  to  in  writing,  software 
// distributed under the License is distributed on an "AS  IS"  BASIS,  WITHOUT
// WARRANTIES OR CONDITIONS  OF  ANY  KIND, either express or implied.  See the 
// License for the specific  language  governing  permissions  and  limitations 
// under the License.
//
// This code is based on  original  work  of  Jean-loup Gailly  and  Mark Adler

//
//  Copyright (C) 1995-2003 Jean-loup Gailly and Mark Adler
//
//  This software is provided 'as-is', without any express or implied
//  warranty.  In no event will the authors be held liable for any damages
//  arising from the use of this software.
//
//  Permission is granted to anyone to use this software for any purpose,
//  including commercial applications, and to alter it and redistribute it
//  freely, subject to the following restrictions:
//
//  1. The origin of this software must not be misrepresented; you must not
//     claim that you wrote the original software. If you use this software
//     in a product, an acknowledgment in the product documentation would be
//     appreciated but is not required.
//  2. Altered source versions must be plainly marked as such, and must not be
//     misrepresented as being the original software.
//  3. This notice may not be removed or altered from any source distribution.
//
//

import {InputBuffer} from "./input";
import {HuffmanTree} from "./huffman-trees";

export class Inflate implements Iterator<number>
{
    // Adler-32
    private s1: number = 1;
    private s2: number = 0;


    private _literalLengthTree: HuffmanTree;
    private _distanceTree: HuffmanTree;
    private _end_of_block_code_seen;
    private _bfinal: number;
    private _isDynamic: boolean;
    private _iterator: Iterator<number>;
    private _state: State = State.ReadingFinalBit;

    // IO
    private _input: InputBuffer;

    // Window
    private _end: number = 0;   // this is the position to where we should write next byte 
    private _current: number = 0;
    private _window = new Array<number>(WindowSize);   //The window is 2^15 bytes

    private _lengthDecompressed: number = 0;   // The number of bytes in the output window ready for serving.
    private _lengthUncompressed: number = 0;   // Number of uncompressed bytes to pass through

    private _codeList = new Array<number>(HuffmanTree.MaxLiteralTreeElements + HuffmanTree.MaxDistTreeElements);
    private _codeLengthTreeCodeLength = new Array<number>(HuffmanTree.NumberOfCodeLengthTreeElements);



    // const tables used in decoding:

    // Extra bits for length code 257 - 285.  
    static s_extraLengthBits = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2,
        2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

    // The base length for length code 257 - 285.
    // The formula to get the real length for a length code is lengthBase[code - 257] + (value stored in extraBits)
    static s_lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13,
        15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
        67, 83, 99, 115, 131, 163, 195, 227, 258];

    // The base distance for distance code 0 - 29    
    // The real distance for a distance code is  distanceBasePosition[code] + (value stored in extraBits)
    static s_distanceBasePosition = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65,
        97, 129, 193, 257, 385, 513, 769, 1025, 1537,
        2049, 3073, 4097, 6145, 8193, 12289, 16385,
        24577, 0, 0];

    // code lengths for code length alphabet is stored in following order
    static s_codeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5,
        11, 4, 12, 3, 13, 2, 14, 1, 15];

    static s_staticDistanceTreeTable = [
        0x00, 0x10, 0x08, 0x18, 0x04, 0x14, 0x0c, 0x1c, 0x02, 0x12, 0x0a, 0x1a,
        0x06, 0x16, 0x0e, 0x1e, 0x01, 0x11, 0x09, 0x19, 0x05, 0x15, 0x0d, 0x1d,
        0x03, 0x13, 0x0b, 0x1b, 0x07, 0x17, 0x0f, 0x1f,
    ];

    private _verifyAdler: Function;

    ///////////////////////////////////////////////////////////////////////////

    public constructor(iterator: Iterator<number>, verify: Function = null) {
        this._input = new InputBuffer(iterator);
        this._iterator = iterator;
        this._verifyAdler = verify;
    }

    ///////////////////////////////////////////////////////////////////////////


    public next(): IteratorResult<number> {

        do
        {
            if (0 < this._lengthDecompressed)
            {
                this._current = (this._end - this._lengthDecompressed) & WindowMask;
                this._lengthDecompressed--;
                return { done: false, value: this._window[this._current] };
            }

            if (0 < this._lengthUncompressed)
            {
                var result: IteratorResult<number> = this._iterator.next();
                if (result.done) throw "End Of Stream Exception";
                this._current = this._end;
                this._window[this._current] = result.value;
                this._end = (this._end + 1) & WindowMask;
                this._lengthUncompressed--;

                this.s1 += result.value;
                this.s2 += this.s1;
                return result;
            }

            this.s1 %= BASE;
            this.s2 %= BASE;

        } while ((State.Done != this._state) && this.Decode());

        if (null != this._verifyAdler)
        { 
            this._verifyAdler(((this.s2 % BASE) << 16) | (this.s1 % BASE));
        }
        this._current = -1;

        return { done: true, value: undefined };
    }


    ///////////////////////////////////////////////////////////////////////////

    private Decode(): boolean {
        this._end_of_block_code_seen = false;
        var result = false;

        while (true) {
            switch (this._state) {
                case State.ReadingFinalBit: // reading final bit
                    this._bfinal = this._input.GetBits(1);
                    this._state = State.ReadingBlockType;

                case State.ReadingBlockType:
                    this._state = <State>this._input.GetBits(2);
                    continue;

                case State.ReadingStatic:
                    this._literalLengthTree = HuffmanTree.StaticLiteralLengthTree;
                    this._distanceTree = HuffmanTree.StaticDistanceTree;
                    this._isDynamic = false;
                    this._state = State.DecodingBlock;
                    continue;

                case State.ReadingDynamic:
                    this.DecodeDynamicBlockHeader();
                    this._isDynamic = true;

                case State.DecodingBlock:
                    result = this.DecodeBlock();
                    break;

                case State.ReadingUncompressed:
                    result = this.DecodeUncompressedBlock();
                    this._end_of_block_code_seen = true;
                    break;

                default:
                    throw "Unknown Block Type";
            }

            break;
        }

        if (this._end_of_block_code_seen && (this._bfinal != 0)) {
            this._state = State.Done;
        }

        return result;
    }

    private DecodeUncompressedBlock(): boolean {
        this._input.SkipToByteBoundary();   // we must skip to a byte boundary
        this._lengthUncompressed = this._input.GetBits(8) + this._input.GetBits(8) * 256;
        var blockLengthComplement = this._input.GetBits(8) + this._input.GetBits(8) * 256;

        // make sure complement matches
        if (this._lengthUncompressed != (~blockLengthComplement)) {
            throw "InvalidBlockLength";
        }

        this._state = State.ReadingFinalBit;

        return true;
    }

    private DecodeBlock(): boolean {
        var extraBits;
        var freeBytes = WindowSize - this._lengthDecompressed;

        // 258 means we can safely do decoding since maximum repeat length is 258
        while (freeBytes > 258) {   
            // Process next symbol
            var smbl = this._literalLengthTree.GetNextSymbol(this._input);

            if (smbl < 256)       // literal
            {
                this.Write(smbl);
                --freeBytes;
                continue;
            }

            if (smbl == 256)      // end of block
            {   // Reset state
                this._state = State.ReadingFinalBit;
                this._end_of_block_code_seen = true;
                return true;
            }

            // length/distance pair
            smbl -= 257;     // length code started at 257
            if (smbl < 8) {
                smbl += 3;   // match length = 3,4,5,6,7,8,9,10
                extraBits = 0;
            }
            else if (smbl == 28) {   // extra bits for code 285 is 0 
                smbl = 258;             // code 285 means length 258    
                extraBits = 0;
            }
            else {
                if (smbl < 0 || smbl >= Inflate.s_extraLengthBits.length) {
                    throw "GenericInvalidData";
                }
                extraBits = Inflate.s_extraLengthBits[smbl];
            }

            var length = smbl;
            if (extraBits > 0) {
                var bits = this._input.GetBits(extraBits);

                if (length < 0 || length >= Inflate.s_lengthBase.length) {
                    throw "GenericInvalidData";
                }
                length = Inflate.s_lengthBase[length] + bits;
            }

            var distanceCode;
            if (this._isDynamic) {
                distanceCode = this._distanceTree.GetNextSymbol(this._input);
            }
            else {   // get distance code directly for static block
                distanceCode = this._input.GetBits(5);
                if (distanceCode >= 0) {
                    distanceCode = Inflate.s_staticDistanceTreeTable[distanceCode];
                }
            }

            // To avoid a table lookup we note that for distanceCode >= 2,
            // extra_bits = (distanceCode-2) >> 1
            var offset;
            if (distanceCode > 3) {
                extraBits = (distanceCode - 2) >> 1;
                var bits = this._input.GetBits(extraBits);
                offset = Inflate.s_distanceBasePosition[distanceCode] + bits;
            }
            else {
                offset = distanceCode + 1;
            }

            this.WriteLengthDistance(length, offset);
            freeBytes -= length;
        }

        this._state = State.DecodingBlock;
        this._end_of_block_code_seen = false;
        return true;
    }

    private DecodeDynamicBlockHeader(): boolean {
        var loopCounter = 0;
        var literalLengthCodeCount = this._input.GetBits(5);
        var distanceCodeCount = this._input.GetBits(5);
        var codeLengthCodeCount = this._input.GetBits(4);

        literalLengthCodeCount += 257;
        distanceCodeCount += 1;
        codeLengthCodeCount += 4;

        while (loopCounter < codeLengthCodeCount) {
            var bits = this._input.GetBits(3);
            this._codeLengthTreeCodeLength[Inflate.s_codeOrder[loopCounter]] = bits;
            ++loopCounter;
        }

        for (var i = codeLengthCodeCount; i < Inflate.s_codeOrder.length; i++) {
            this._codeLengthTreeCodeLength[Inflate.s_codeOrder[i]] = 0;
        }


        // create huffman tree for code length
        var codeLengthTree = new HuffmanTree(this._codeLengthTreeCodeLength);
        var codeArraySize = literalLengthCodeCount + distanceCodeCount;
        loopCounter = 0;     // reset loop count

        while (loopCounter < codeArraySize) {
            var repeatCount;
            var lengthCode = codeLengthTree.GetNextSymbol(this._input);

            switch (lengthCode) {
                case 18:
                    repeatCount = this._input.GetBits(7) + 11;
                    if (loopCounter + repeatCount > codeArraySize) {
                        throw "Invalid Data Exception";
                    }

                    for (var j = 0; j < repeatCount; j++) {
                        this._codeList[loopCounter++] = 0;
                    }
                    break;

                case 17:
                    repeatCount = this._input.GetBits(3) + 3;
                    if (loopCounter + repeatCount > codeArraySize) {
                        throw "Invalid Data Exception";
                    }

                    for (var j = 0; j < repeatCount; j++) {
                        this._codeList[loopCounter++] = 0;
                    }
                    break;

                case 16:
                    if (loopCounter == 0) {   // can't have "prev code" on first code
                        throw "Invalid Data Exception";
                    }

                    var previousCode = this._codeList[loopCounter - 1];
                    repeatCount = this._input.GetBits(2) + 3;
                    if (loopCounter + repeatCount > codeArraySize) {
                        throw "Invalid Data Exception";
                    }

                    for (var j = 0; j < repeatCount; j++) {
                        this._codeList[loopCounter++] = previousCode;
                    }
                    break;

                default:
                    this._codeList[loopCounter++] = lengthCode;
                    break;
            }
        }


        //byte[] literalTreeCodeLength = new byte[HuffmanTree.MaxLiteralTreeElements];
        //byte[] distanceTreeCodeLength = new byte[HuffmanTree.MaxDistTreeElements];

        //// Create literal and distance tables
        //Array.Copy(this._codeList, literalTreeCodeLength, literalLengthCodeCount);
        //Array.Copy(this._codeList, literalLengthCodeCount, distanceTreeCodeLength, 0, distanceCodeCount);


        var literalTreeCodeLength = this._codeList.slice(0, literalLengthCodeCount);
        for (var l = literalTreeCodeLength.length; l < HuffmanTree.MaxLiteralTreeElements; l++) {
            literalTreeCodeLength.push(0);
        }
        var distanceTreeCodeLength = this._codeList.slice(literalLengthCodeCount, literalLengthCodeCount + distanceCodeCount);
        for (var d = distanceTreeCodeLength.length; d < HuffmanTree.MaxDistTreeElements; d++) {
            distanceTreeCodeLength.push(0);
        }

        // Make sure there is an end-of-block code, otherwise how could we ever end?
        if (literalTreeCodeLength[HuffmanTree.EndOfBlockCode] == 0) {
            throw "Invalid Data Exception";
        }

        this._literalLengthTree = new HuffmanTree(literalTreeCodeLength);
        this._distanceTree = new HuffmanTree(distanceTreeCodeLength);
        return true;
    }


    // Add a byte to output window
    public Write(b: number) {
        this._window[this._end++] = b;
        this._end &= WindowMask;
        this._lengthDecompressed++;

        this.s1 += b;
        this.s2 += this.s1;
    }

    public WriteLengthDistance(length: number, distance: number) {
        // move backwards distance bytes in the output stream, 
        // and copy length bytes from this position to the output stream.
        this._lengthDecompressed += length;
        var copyStart = (this._end - distance) & WindowMask;  // start position for coping.

        var border = WindowSize - length;
        if (copyStart <= border && this._end < border) {
            while (length-- > 0) {
                var source = this._window[copyStart++];
                this._window[this._end++] = source;
                this.s1 += source;
                this.s2 += this.s1;
            }
        }
        else { // copy byte by byte
            while (length-- > 0) {
                var source = this._window[copyStart++];
                this._window[this._end++] = source;
                this._end &= WindowMask;
                copyStart &= WindowMask;
                this.s1 += source;
                this.s2 += this.s1;
            }
        }
    }

    private adler32(index: number, len: number) {
        while (len > 0) {
            if (len >= 16) {
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                this.s1 += this._window[index++]; this.s2 += this.s1;
                len -= 16;
            }
            else {
                while (len-- > 0) {
                    this.s1 += this._window[index++]; this.s2 += this.s1;
                }
            }
        }
    }

}

var BASE = 65521;
var WindowSize = 32768;
var WindowMask = 32767;


enum State {
    ReadingUncompressed = 0,// Passing through uncompressed block
    ReadingStatic = 1,      // About to read static block
    ReadingDynamic = 2,     // About to read dynamic header
    UnknownBlockType = 3,   // Error
    DecodingBlock,          // Decodvar compressed block
    ReadingFinalBit,        // About to read final bit
    ReadingBlockType,       // About to read blockType bits

    Done                    // Finished
}
