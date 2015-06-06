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
// This work largely based on implementation by Microsoft
//
// Strictly speaking this class is not a HuffmanTree, this class  is  a  lookup 
// table combined with a HuffmanTree. The idea is to speed up  the  lookup  for 
// short symbols (they should appear more frequently ideally.) However we don't
// want to create a huge table since it might take longer to  build  the  table 
// than  decoding ( Deflate  usually  generates  new  tables  frequently. )  
// 
// Following paper explains decoding in details:
//   Hirschberg and Lelewer, "Efficient decoding of prefix codes,"
//   Comm. ACM, 33,4, April 1990, pp. 449-459.

import {InputBuffer} from "./input";

export class HuffmanTree {

    public static MaxLiteralTreeElements = 288;
    public static MaxDistTreeElements = 32;
    public static EndOfBlockCode = 256;
    public static NumberOfCodeLengthTreeElements = 19;

    private _tableBits: number;
    private _table: Uint8Array;
    private _left: Uint8Array;
    private _right: Uint8Array;
    private _codeLengthArray: Uint8Array;

    private _tableMask: number;
    private _maxCodeLength = 0;

    // huffman tree for static block
    private static s_staticLiteralLengthTree: HuffmanTree = new HuffmanTree(HuffmanTree.GetStaticLiteralTreeLength());;
    private static s_staticDistanceTree: HuffmanTree = new HuffmanTree(HuffmanTree.GetStaticDistanceTreeLength());

    public static get StaticLiteralLengthTree(): HuffmanTree {
        return HuffmanTree.s_staticLiteralLengthTree;
    }

    public static get StaticDistanceTree(): HuffmanTree {
        return HuffmanTree.s_staticDistanceTree;
    }

    constructor(codeLengths: Uint8Array) {
        // Code lengths
        this._codeLengthArray = codeLengths;
        for (var length in codeLengths) {
            this._maxCodeLength = Math.max(length, this._maxCodeLength);
        }

        if (this._codeLengthArray.length == HuffmanTree.MaxLiteralTreeElements) {   // bits for Literal/Length tree table
            this._tableBits = 9;
            this._tableMask = 0x1FF;
        }
        else {   // bits for distance tree table and code length tree table
            this._tableBits = 7;
            this._tableMask = 0x7F;
        }

        this.CreateTable();
    }


    // Generate the array contains huffman codes lengths for static huffman tree.
    // The data is in RFC 1951.
    private static GetStaticLiteralTreeLength(): Uint8Array {
        var i, literalTreeLength = new Uint8Array(HuffmanTree.MaxLiteralTreeElements);
        for (i = 0; i <= 143; i++)
            literalTreeLength[i] = 8;

        for (i = 144; i <= 255; i++)
            literalTreeLength[i] = 9;

        for (i = 256; i <= 279; i++)
            literalTreeLength[i] = 7;

        for (i = 280; i <= 287; i++)
            literalTreeLength[i] = 8;

        return literalTreeLength;
    }

    private static GetStaticDistanceTreeLength(): Uint8Array {
        var staticDistanceTreeLength = new Uint8Array(HuffmanTree.MaxDistTreeElements);
        for (var i = 0; i < HuffmanTree.MaxDistTreeElements; i++) {
            staticDistanceTreeLength[i] = 5;
        }
        return staticDistanceTreeLength;
    }


    // Calculate the huffman code for each character based on the code length for each character.
    // This algorithm is described in standard RFC 1951
    private CalculateHuffmanCode(): Uint8Array {
        var bitLengthCount = new Uint8Array(17);
        for (var codeLength in this._codeLengthArray) {
            bitLengthCount[codeLength]++;
        }
        bitLengthCount[0] = 0;  // clear count for length 0

        var nextCode = new Uint8Array(17);
        var tempCode = 0;
        for (var bits = 1; bits <= 16; bits++) {
            tempCode = (tempCode + bitLengthCount[bits - 1]) << 1;
            nextCode[bits] = tempCode;
        }

        var code = new Uint8Array(HuffmanTree.MaxLiteralTreeElements);
        for (var i = 0; i < this._codeLengthArray.length; i++) {
            var len = this._codeLengthArray[i];

            if (len > 0) {
                code[i] = HuffmanTree.BitReverse(nextCode[len], len);
                nextCode[len]++;
            }
        }
        return code;
    }

    private CreateTable() {
        var codeArray = this.CalculateHuffmanCode();
        this._table = new Uint8Array(1 << this._tableBits);

        // I need to find proof that left and right array will always be 
        // enough. I think they are.
        this._left = new Uint8Array(2 * this._codeLengthArray.length);
        this._right = new Uint8Array(2 * this._codeLengthArray.length);
        var avail = this._codeLengthArray.length;

        for (var ch = 0; ch < this._codeLengthArray.length; ch++) {
            // length of this code
            var len = this._codeLengthArray[ch];
            if (len > 0) {
                // start value (bit reversed)
                var start = codeArray[ch];

                if (len <= this._tableBits) {
                    // If a particular symbol is shorter than nine bits, 
                    // then that symbol's translation is duplicated
                    // in all those entries that start with that symbol's bits.  
                    // For example, if the symbol is four bits, then it's duplicated 
                    // 32 times in a nine-bit table. If a symbol is nine bits long, 
                    // it appears in the table once.
                    // 
                    // Make sure that in the loop below, code is always
                    // less than table_size.
                    //
                    // On last iteration we store at array index:
                    //    initial_start_at + (locs-1)*increment
                    //  = initial_start_at + locs*increment - increment
                    //  = initial_start_at + (1 << tableBits) - increment
                    //  = initial_start_at + table_size - increment
                    //
                    // Therefore we must ensure:
                    //     initial_start_at + table_size - increment < table_size
                    // or: initial_start_at < increment
                    //
                    var increment = 1 << len;
                    if (start >= increment) {
                        throw "InvalidHuffmanData";
                    }

                    // Note the bits in the table are reverted.
                    var locs = 1 << (this._tableBits - len);
                    for (var j = 0; j < locs; j++) {
                        this._table[start] = ch;
                        start += increment;
                    }
                }
                else {
                    // For any code which has length longer than num_elements,
                    // build a binary tree.

                    var overflowBits = len - this._tableBits;    // the nodes we need to respent the data.
                    var codeBitMask = 1 << this._tableBits;    // mask to get current bit (the bits can't fit in the table)  

                    // the left, right table is used to repesent the
                    // the rest bits. When we got the first part (number bits.) and look at
                    // tbe table, we will need to follow the tree to find the real character.
                    // This is in place to avoid bloating the table if there are
                    // a few ones with long code.
                    var index = start & ((1 << this._tableBits) - 1);
                    var array = this._table;

                    do {
                        var value = array[index];

                        if (value == 0) {           // set up next pointer if this node is not used before.
                            array[index] = -avail;  // use next available slot.
                            value = -avail;
                            avail++;
                        }

                        if (value > 0) {         // prevent an IndexOutOfRangeException from array[index]
                            throw "InvalidHuffmanData";
                        }

                        if ((start & codeBitMask) == 0) {  // if current bit is 0, go change the left array
                            array = this._left;
                        }
                        else {                // if current bit is 1, set value in the right array
                            array = this._right;
                        }
                        index = -value;         // go to next node

                        codeBitMask <<= 1;
                        overflowBits--;
                    } while (overflowBits != 0);

                    array[index] = ch;
                }
            }
        }
    }

    // This function will try to get enough bits from input and 
    // try to decode the bits.
    // If there are no enought bits in the input, this function will return -1.
    //
    public GetNextSymbol(input: InputBuffer): number {
        // Try to load up to 15 bits into input buffer
        var bitBuffer = input.TryGetBits(this._maxCodeLength);

        // decode an element 
        var symbol = this._table[bitBuffer & this._tableMask];
        if (symbol < 0) {   //  this will be the start of the binary tree
            // navigate the tree
            var mask = 1 << this._tableBits;
            do {
                symbol = -symbol;
                if ((bitBuffer & mask) == 0)
                    symbol = this._left[symbol];
                else
                    symbol = this._right[symbol];
                mask <<= 1;
            } while (symbol < 0);
        }

        var codeLength = this._codeLengthArray[symbol];

        // If this code is longer than the # bits we had in the bit buffer 
        // (i.e. we read only part of the code), not good.
        if (codeLength > input.AvailableBits) {
            throw "EndOfStreamException()";
        }
        input.SkipBits(codeLength);

        return symbol;
    }

    public static BitReverse(code: number, length: number): number {
        var num = 0;
        do {
            num |= code & 1;
            num = num << 1;
            code = code >> 1;
        }
        while (--length > 0);
        return (num >> 1);
    }
}


