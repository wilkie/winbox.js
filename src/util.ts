'use strict';

/**
 * A set of utility functions that are generically useful.
 */
export class Util {
  static async readAsyncString(stream, offset, length = -1) {
    let ret = '';
    let maxLength = length;
    if (length == -1) {
      maxLength = 100;
    }

    for (let i = 0; i < maxLength; i++) {
      const o = offset + i;
      const c = String.fromCharCode(await stream.read8(o));
      if (c === '\0') {
        break;
      }
      ret = ret + c;
    }
    return ret;
  }

  static readString(data, offset, length = -1) {
    let ret = '';
    let maxLength = length;
    if (length == -1) {
      maxLength = 100;
    }

    for (let i = 0; i < maxLength; i++) {
      const o = offset + i;
      const c = String.fromCharCode(data.getUint8(o));
      if (c === '\0') {
        break;
      }
      ret = ret + c;
    }
    return ret;
  }

  static async readAsyncStructure(stream, struct, offset, littleEndian = true) {
    const ret = {};

    const keys = Object.keys(struct);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const size = struct[key][1];

      if (typeof size === 'string') {
        const length = parseInt(size);
        ret[key] = await Util.readAsyncString(stream, offset + struct[key][0], length);
      } else if (size == 1) {
        ret[key] = await stream.read8(offset + struct[key][0]);
      } else if (size == 2) {
        ret[key] = await stream.read16(offset + struct[key][0], littleEndian);
      } else if (size == 4) {
        ret[key] = await stream.read32(offset + struct[key][0], littleEndian);
      } else if (size == -1) {
        ret[key] = await stream.readSigned8(offset + struct[key][0]);
      } else if (size == -2) {
        ret[key] = await stream.readSigned16(offset + struct[key][0], littleEndian);
      } else if (size == -4) {
        ret[key] = await stream.readSigned32(offset + struct[key][0], littleEndian);
      }
    }

    return ret;
  }

  static readStructure(data, struct, offset, littleEndian = true): any {
    const ret: any = {};

    Object.keys(struct).forEach((key) => {
      const size = struct[key][1];

      if (typeof size === 'string') {
        const length = parseInt(size);
        ret[key] = Util.readString(data, offset + struct[key][0], length);
      } else if (size == 1) {
        ret[key] = data.getUint8(offset + struct[key][0]);
      } else if (size == 2) {
        ret[key] = data.getUint16(offset + struct[key][0], littleEndian);
      } else if (size == 4) {
        ret[key] = data.getUint32(offset + struct[key][0], littleEndian);
      } else if (size == -1) {
        ret[key] = data.getInt8(offset + struct[key][0]);
      } else if (size == -2) {
        ret[key] = data.getInt16(offset + struct[key][0], littleEndian);
      } else if (size == -4) {
        ret[key] = data.getInt32(offset + struct[key][0], littleEndian);
      }
    });

    return ret;
  }
}

export default Util;
