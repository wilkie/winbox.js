'use strict';

/** @namespace OleCli */

import { Module } from '../module.js';
import { segmentSelector } from '../selectors.js';
import { BOOL, DWORD, INT, UINT } from '../types.js';
import * as api from './api.js';
import { NAME, Ole, PATH } from './core.js';
import { callOwnMethod, mfCallback } from './methods.js';
import { Loader } from '../loader.js';
import { exportAddress, isObject, kindOf, registerAddress, registerMethods } from './objects.js';
import { convProc } from './linked.js';
import { DEFAULTS, HANDLER_EXPORTS, PAINTBRUSH, type Way, leCreateInvisible } from './handlers.js';
import {
  checkNetDrive,
  connectDlgProc,
  getTaskVisibleWindow,
  setNetName,
  setNextNetDrive,
} from './network.js';
import { start } from './start.js';

/**
 * `OLECLI`, OLE 1.0's client library, as WinBox's own: written from OLE
 * 1.0's documented interface and from the probes `olestat` and `olemem`,
 * not from the code of `OLECLI.DLL` (`kb/topics/ole.md`). As
 * `crates/winbox-win16/src/olecli/`.
 *
 * Kept as `DDEML` is (`own-modules.ts`): with `OLECLI.DLL` on the drive, a
 * program that imports it gets the file's library, and each import of an
 * export answered here is linked to WinBox's stub, as `GetProcAddress`
 * answers it; with none, WinBox's is found by its file's name. It is kept
 * only once a program loads it, so a session with no OLE is as it was.
 *
 * The ordinals and names are the file's entry table's: its API, then its
 * window procedures and metafile callback (100-102), its object handlers'
 * defaults (110-117), each kind of object's methods at its hundred --
 * embedded and linked 200, picture 300, bitmap 400, DIB 500, another
 * class's 600, the refusals 700, the shared 900 -- and 950-954 its network
 * dialog's. Entries 955 on have no name; 1026-1030 are methods an object's
 * table holds (**measured** by `olemem`).
 *
 * @memberof Win16
 */

/** Each entry: its ordinal, its name in the file (none for 955 on), the bytes of arguments its `RETF` pops (read out of the file, `scripts/oracle/argument-sizes.mjs`). */
const ENTRIES: [number, string | null, number][] = [
  [1, 'WEP', 2],
  [2, 'OLEDELETE', 4],
  [3, 'OLESAVETOSTREAM', 8],
  [4, 'OLELOADFROMSTREAM', 24],
  [6, 'OLECLONE', 20],
  [7, 'OLECOPYFROMLINK', 24],
  [8, 'OLEEQUAL', 8],
  [9, 'OLEQUERYLINKFROMCLIP', 8],
  [10, 'OLEQUERYCREATEFROMCLIP', 8],
  [11, 'OLECREATELINKFROMCLIP', 24],
  [12, 'OLECREATEFROMCLIP', 24],
  [13, 'OLECOPYTOCLIPBOARD', 4],
  [14, 'OLEQUERYTYPE', 8],
  [15, 'OLESETHOSTNAMES', 12],
  [16, 'OLESETTARGETDEVICE', 6],
  [17, 'OLESETBOUNDS', 8],
  [18, 'OLEQUERYBOUNDS', 8],
  [19, 'OLEDRAW', 16],
  [20, 'OLEQUERYOPEN', 4],
  [21, 'OLEACTIVATE', 16],
  [22, 'OLEUPDATE', 4],
  [23, 'OLERECONNECT', 4],
  [24, 'OLEGETLINKUPDATEOPTIONS', 8],
  [25, 'OLESETLINKUPDATEOPTIONS', 6],
  [26, 'OLEENUMFORMATS', 6],
  [27, 'OLECLOSE', 4],
  [28, 'OLEGETDATA', 10],
  [29, 'OLESETDATA', 8],
  [30, 'OLEQUERYPROTOCOL', 8],
  [31, 'OLEQUERYOUTOFDATE', 4],
  [32, 'OLEOBJECTCONVERT', 24],
  [33, 'OLECREATEFROMTEMPLATE', 28],
  [34, 'OLECREATE', 28],
  [35, 'OLEQUERYRELEASESTATUS', 4],
  [36, 'OLEQUERYRELEASEERROR', 4],
  [37, 'OLEQUERYRELEASEMETHOD', 4],
  [38, 'OLECREATEFROMFILE', 32],
  [39, 'OLECREATELINKFROMFILE', 36],
  [40, 'OLERELEASE', 4],
  [41, 'OLEREGISTERCLIENTDOC', 16],
  [42, 'OLEREVOKECLIENTDOC', 4],
  [43, 'OLERENAMECLIENTDOC', 8],
  [44, 'OLEREVERTCLIENTDOC', 4],
  [45, 'OLESAVEDCLIENTDOC', 4],
  [46, 'OLERENAME', 8],
  [47, 'OLEENUMOBJECTS', 8],
  [48, 'OLEQUERYNAME', 12],
  [49, 'OLESETCOLORSCHEME', 8],
  [50, 'OLEREQUESTDATA', 6],
  [54, 'OLELOCKSERVER', 8],
  [55, 'OLEUNLOCKSERVER', 4],
  [56, 'OLEQUERYSIZE', 8],
  [57, 'OLEEXECUTE', 8],
  [58, 'OLECREATEINVISIBLE', 30],
  [59, 'OLEQUERYCLIENTVERSION', 0],
  [60, 'OLEISDCMETA', 2],
  [100, 'DOCWNDPROC', 10],
  [101, 'SRVRWNDPROC', 10],
  [102, 'MFCALLBACKFUNC', 16],
  [110, 'DEFLOADFROMSTREAM', 32],
  [111, 'DEFCREATEFROMCLIP', 28],
  [112, 'DEFCREATELINKFROMCLIP', 24],
  [113, 'DEFCREATEFROMTEMPLATE', 28],
  [114, 'DEFCREATE', 28],
  [115, 'DEFCREATEFROMFILE', 32],
  [116, 'DEFCREATELINKFROMFILE', 36],
  [117, 'DEFCREATEINVISIBLE', 30],
  [200, 'LERELEASE', 4],
  [201, 'LESHOW', 6],
  [202, 'LEGETDATA', 10],
  [203, 'LESETDATA', 8],
  [204, 'LESETHOSTNAMES', 12],
  [205, 'LESETTARGETDEVICE', 6],
  [206, 'LESETBOUNDS', 8],
  [207, 'LESAVETOSTREAM', 8],
  [208, 'LECLONE', 20],
  [209, 'LECOPYFROMLINK', 20],
  [210, 'LEEQUAL', 8],
  [211, 'LECOPY', 4],
  [212, 'LEQUERYTYPE', 8],
  [213, 'LEQUERYBOUNDS', 8],
  [214, 'LEDRAW', 16],
  [215, 'LEQUERYOPEN', 4],
  [216, 'LEACTIVATE', 16],
  [218, 'LEUPDATE', 4],
  [219, 'LERECONNECT', 4],
  [220, 'LEENUMFORMAT', 6],
  [221, 'LEQUERYPROTOCOL', 8],
  [222, 'LEQUERYOUTOFDATE', 4],
  [223, 'LEOBJECTCONVERT', 24],
  [224, 'LECHANGEDATA', 12],
  [225, 'LECLOSE', 4],
  [226, 'LEGETUPDATEOPTIONS', 8],
  [227, 'LESETUPDATEOPTIONS', 6],
  [228, 'LEEXECUTE', 8],
  [229, 'LEOBJECTLONG', 10],
  [230, 'LECREATEINVISIBLE', 26],
  [300, 'MFRELEASE', 4],
  [301, 'MFGETDATA', 10],
  [302, 'MFSAVETOSTREAM', 8],
  [303, 'MFCLONE', 20],
  [304, 'MFEQUAL', 8],
  [305, 'MFCOPY', 4],
  [307, 'MFQUERYBOUNDS', 8],
  [308, 'MFDRAW', 16],
  [309, 'MFENUMFORMAT', 6],
  [310, 'MFCHANGEDATA', 12],
  [400, 'BMRELEASE', 4],
  [401, 'BMGETDATA', 10],
  [402, 'BMSAVETOSTREAM', 8],
  [403, 'BMCLONE', 20],
  [404, 'BMEQUAL', 8],
  [405, 'BMCOPY', 4],
  [407, 'BMQUERYBOUNDS', 8],
  [408, 'BMDRAW', 16],
  [409, 'BMENUMFORMAT', 6],
  [410, 'BMCHANGEDATA', 12],
  [500, 'DIBRELEASE', 4],
  [501, 'DIBGETDATA', 10],
  [502, 'DIBSAVETOSTREAM', 8],
  [503, 'DIBCLONE', 20],
  [504, 'DIBEQUAL', 8],
  [505, 'DIBCOPY', 4],
  [507, 'DIBQUERYBOUNDS', 8],
  [508, 'DIBDRAW', 16],
  [509, 'DIBENUMFORMAT', 6],
  [510, 'DIBCHANGEDATA', 12],
  [600, 'GENRELEASE', 4],
  [601, 'GENGETDATA', 10],
  [602, 'GENSETDATA', 8],
  [603, 'GENSAVETOSTREAM', 8],
  [604, 'GENCLONE', 20],
  [605, 'GENEQUAL', 8],
  [606, 'GENCOPY', 4],
  [608, 'GENQUERYBOUNDS', 8],
  [609, 'GENDRAW', 16],
  [610, 'GENENUMFORMAT', 6],
  [611, 'GENCHANGEDATA', 12],
  [701, 'ERRSHOW', 6],
  [702, 'ERRSETDATA', 8],
  [703, 'ERRSETHOSTNAMES', 12],
  [704, 'ERRSETTARGETDEVICE', 6],
  [705, 'ERRSETBOUNDS', 8],
  [706, 'ERRCOPYFROMLINK', 20],
  [707, 'ERRQUERYOPEN', 4],
  [708, 'ERRACTIVATE', 16],
  [709, 'ERRCLOSE', 4],
  [710, 'ERRUPDATE', 4],
  [711, 'ERRRECONNECT', 4],
  [712, 'ERRQUERYPROTOCOL', 8],
  [713, 'ERRQUERYOUTOFDATE', 4],
  [714, 'ERROBJECTCONVERT', 24],
  [715, 'ERRGETUPDATEOPTIONS', 8],
  [716, 'ERRSETUPDATEOPTIONS', 6],
  [717, 'ERREXECUTE', 8],
  [718, 'ERROBJECTLONG', 10],
  [800, 'PBLOADFROMSTREAM', 32],
  [801, 'PBCREATEFROMCLIP', 28],
  [802, 'PBCREATELINKFROMCLIP', 24],
  [803, 'PBCREATEFROMTEMPLATE', 28],
  [804, 'PBCREATE', 28],
  [805, 'PBDRAW', 16],
  [806, 'PBQUERYBOUNDS', 8],
  [807, 'PBCOPYTOCLIPBOARD', 4],
  [808, 'PBCREATEFROMFILE', 32],
  [809, 'PBCREATELINKFROMFILE', 36],
  [810, 'PBENUMFORMATS', 6],
  [811, 'PBGETDATA', 10],
  [812, 'PBCREATEINVISIBLE', 30],
  [910, 'OBJQUERYNAME', 12],
  [911, 'OBJRENAME', 8],
  [912, 'OBJQUERYTYPE', 8],
  [913, 'OBJQUERYSIZE', 8],
  [950, 'CONNECTDLGPROC', 10],
  [951, 'SETNETNAME', 4],
  [952, 'CHECKNETDRIVE', 6],
  [953, 'SETNEXTNETDRIVE', 12],
  [954, 'GETTASKVISIBLEWINDOW', 6],
  [955, null, 12],
  [956, null, 36],
  [957, null, 20],
  [958, null, 20],
  [959, null, 20],
  [960, null, 26],
  [961, null, 4],
  [962, null, 4],
  [963, null, 24],
  [964, null, 28],
  [965, null, 4],
  [966, null, 6],
  [967, null, 2],
  [968, null, 12],
  [969, null, 4],
  [970, null, 4],
  [971, null, 10],
  [972, null, 0],
  [973, null, 24],
  [974, null, 24],
  [975, null, 22],
  [976, null, 20],
  [977, null, 28],
  [978, null, 28],
  [979, null, 24],
  [980, null, 0],
  [981, null, 24],
  [982, null, 0],
  [983, null, 24],
  [984, null, 0],
  [985, null, 8],
  [986, null, 2],
  [987, null, 4],
  [988, null, 4],
  [989, null, 4],
  [990, null, 4],
  [991, null, 20],
  [992, null, 12],
  [993, null, 6],
  [994, null, 14],
  [995, null, 4],
  [996, null, 8],
  [997, null, 2],
  [998, null, 4],
  [999, null, 4],
  [1000, null, 6],
  [1001, null, 4],
  [1002, null, 4],
  [1003, null, 4],
  [1004, null, 8],
  [1005, null, 10],
  [1006, null, 6],
  [1007, null, 4],
  [1008, null, 4],
  [1009, null, 8],
  [1010, null, 4],
  [1011, null, 4],
  [1012, null, 4],
  [1013, null, 4],
  [1014, null, 4],
  [1015, null, 12],
  [1016, null, 12],
  [1017, null, 12],
  [1018, null, 12],
  [1019, null, 14],
  [1020, null, 16],
  [1021, null, 0],
  [1022, null, 8],
  [1023, null, 0],
  [1024, null, 4],
  [1025, null, 8],
  [1026, null, 6],
  [1027, null, 4],
  [1028, null, 8],
  [1029, null, 10],
  [1030, null, 8],
  [1031, null, 12],
  [1032, null, 8],
  [1033, null, 8],
  [1034, null, 10],
  [1035, null, 10],
];

const OBJ = DWORD;
const PTR = DWORD;

/** The API's functions, by the file's name: the function, the name WinBox's table gives it, its arguments and its answer. */
const API: Record<string, [any, string, number[], number]> = {
  OLEDELETE: [api.OleDelete, 'OleDelete', [OBJ], UINT],
  OLESAVETOSTREAM: [api.OleSaveToStream, 'OleSaveToStream', [OBJ, PTR], UINT],
  OLELOADFROMSTREAM: [
    api.OleLoadFromStream,
    'OleLoadFromStream',
    [PTR, PTR, PTR, DWORD, PTR, PTR],
    UINT,
  ],
  OLECLONE: [api.OleClone, 'OleClone', [OBJ, PTR, DWORD, PTR, PTR], UINT],
  OLECOPYFROMLINK: [api.OleCopyFromLink, 'OleCopyFromLink', [OBJ, PTR, PTR, DWORD, PTR, PTR], UINT],
  OLEEQUAL: [api.OleEqual, 'OleEqual', [OBJ, OBJ], UINT],
  OLEQUERYLINKFROMCLIP: [api.OleQueryLinkFromClip, 'OleQueryLinkFromClip', [PTR, UINT, UINT], UINT],
  OLEQUERYCREATEFROMCLIP: [
    api.OleQueryCreateFromClip,
    'OleQueryCreateFromClip',
    [PTR, UINT, UINT],
    UINT,
  ],
  OLECREATELINKFROMCLIP: [
    api.OleCreateLinkFromClip,
    'OleCreateLinkFromClip',
    [PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
    UINT,
  ],
  OLECREATEFROMCLIP: [
    api.OleCreateFromClip,
    'OleCreateFromClip',
    [PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
    UINT,
  ],
  OLECOPYTOCLIPBOARD: [api.OleCopyToClipboard, 'OleCopyToClipboard', [OBJ], UINT],
  OLEQUERYTYPE: [api.OleQueryType, 'OleQueryType', [OBJ, PTR], UINT],
  OLESETHOSTNAMES: [api.OleSetHostNames, 'OleSetHostNames', [OBJ, PTR, PTR], UINT],
  OLESETTARGETDEVICE: [api.OleSetTargetDevice, 'OleSetTargetDevice', [OBJ, UINT], UINT],
  OLESETBOUNDS: [api.OleSetBounds, 'OleSetBounds', [OBJ, PTR], UINT],
  OLEQUERYBOUNDS: [api.OleQueryBounds, 'OleQueryBounds', [OBJ, PTR], UINT],
  OLEDRAW: [api.OleDraw, 'OleDraw', [OBJ, UINT, PTR, PTR, UINT], UINT],
  OLEQUERYOPEN: [api.OleQueryOpen, 'OleQueryOpen', [OBJ], UINT],
  OLEACTIVATE: [api.OleActivate, 'OleActivate', [OBJ, UINT, BOOL, BOOL, UINT, PTR], UINT],
  OLEUPDATE: [api.OleUpdate, 'OleUpdate', [OBJ], UINT],
  OLERECONNECT: [api.OleReconnect, 'OleReconnect', [OBJ], UINT],
  OLEGETLINKUPDATEOPTIONS: [
    api.OleGetLinkUpdateOptions,
    'OleGetLinkUpdateOptions',
    [OBJ, PTR],
    UINT,
  ],
  OLESETLINKUPDATEOPTIONS: [
    api.OleSetLinkUpdateOptions,
    'OleSetLinkUpdateOptions',
    [OBJ, UINT],
    UINT,
  ],
  OLEENUMFORMATS: [api.OleEnumFormats, 'OleEnumFormats', [OBJ, UINT], UINT],
  OLECLOSE: [api.OleClose, 'OleClose', [OBJ], UINT],
  OLEGETDATA: [api.OleGetData, 'OleGetData', [OBJ, UINT, PTR], UINT],
  OLESETDATA: [api.OleSetData, 'OleSetData', [OBJ, UINT, UINT], UINT],
  OLEQUERYPROTOCOL: [api.OleQueryProtocol, 'OleQueryProtocol', [OBJ, PTR], DWORD],
  OLEQUERYOUTOFDATE: [api.OleQueryOutOfDate, 'OleQueryOutOfDate', [OBJ], UINT],
  OLEOBJECTCONVERT: [
    api.OleObjectConvert,
    'OleObjectConvert',
    [OBJ, PTR, PTR, DWORD, PTR, PTR],
    UINT,
  ],
  OLECREATEFROMTEMPLATE: [
    api.OleCreateFromTemplate,
    'OleCreateFromTemplate',
    [PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
    UINT,
  ],
  OLECREATE: [api.OleCreate, 'OleCreate', [PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT], UINT],
  OLEQUERYRELEASESTATUS: [api.OleQueryReleaseStatus, 'OleQueryReleaseStatus', [OBJ], UINT],
  OLEQUERYRELEASEERROR: [api.OleQueryReleaseError, 'OleQueryReleaseError', [OBJ], UINT],
  OLEQUERYRELEASEMETHOD: [api.OleQueryReleaseMethod, 'OleQueryReleaseMethod', [OBJ], UINT],
  OLECREATEFROMFILE: [
    api.OleCreateFromFile,
    'OleCreateFromFile',
    [PTR, PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
    UINT,
  ],
  OLECREATELINKFROMFILE: [
    api.OleCreateLinkFromFile,
    'OleCreateLinkFromFile',
    [PTR, PTR, PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
    UINT,
  ],
  OLERELEASE: [api.OleRelease, 'OleRelease', [OBJ], UINT],
  OLEREGISTERCLIENTDOC: [
    api.OleRegisterClientDoc,
    'OleRegisterClientDoc',
    [PTR, PTR, DWORD, PTR],
    UINT,
  ],
  OLEREVOKECLIENTDOC: [api.OleRevokeClientDoc, 'OleRevokeClientDoc', [DWORD], UINT],
  OLERENAMECLIENTDOC: [api.OleRenameClientDoc, 'OleRenameClientDoc', [DWORD, PTR], UINT],
  OLEREVERTCLIENTDOC: [api.OleRevertClientDoc, 'OleRevertClientDoc', [DWORD], UINT],
  OLESAVEDCLIENTDOC: [api.OleSavedClientDoc, 'OleSavedClientDoc', [DWORD], UINT],
  OLERENAME: [api.OleRename, 'OleRename', [OBJ, PTR], UINT],
  OLEENUMOBJECTS: [api.OleEnumObjects, 'OleEnumObjects', [DWORD, PTR], UINT],
  OLEQUERYNAME: [api.OleQueryName, 'OleQueryName', [OBJ, PTR, PTR], UINT],
  OLESETCOLORSCHEME: [api.OleSetColorScheme, 'OleSetColorScheme', [OBJ, PTR], UINT],
  OLEREQUESTDATA: [api.OleRequestData, 'OleRequestData', [OBJ, UINT], UINT],
  OLELOCKSERVER: [api.OleLockServer, 'OleLockServer', [OBJ, PTR], UINT],
  OLEUNLOCKSERVER: [api.OleUnlockServer, 'OleUnlockServer', [DWORD], UINT],
  OLEQUERYSIZE: [api.OleQuerySize, 'OleQuerySize', [OBJ, PTR], UINT],
  OLEEXECUTE: [api.OleExecute, 'OleExecute', [OBJ, UINT, UINT], UINT],
  OLECREATEINVISIBLE: [
    api.OleCreateInvisible,
    'OleCreateInvisible',
    [PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT, BOOL],
    UINT,
  ],
  OLEQUERYCLIENTVERSION: [api.OleQueryClientVersion, 'OleQueryClientVersion', [], DWORD],
  OLEISDCMETA: [api.OleIsDcMeta, 'OleIsDcMeta', [UINT], BOOL],
};

/**
 * Each method's arguments after the object, by `OLEOBJECTVTBL`'s
 * declarations (ole.h): what a method export of a kind's is given.
 */
const METHOD_ARGS: Record<string, number[]> = {
  QueryProtocol: [PTR],
  Release: [],
  Show: [BOOL],
  DoVerb: [UINT, BOOL, BOOL],
  GetData: [UINT, PTR],
  SetData: [UINT, UINT],
  SetTargetDevice: [UINT],
  SetBounds: [PTR],
  EnumFormats: [UINT],
  SetColorScheme: [PTR],
  Delete: [],
  SetHostNames: [PTR, PTR],
  SaveToStream: [PTR],
  Clone: [PTR, DWORD, PTR, PTR],
  CopyFromLink: [PTR, DWORD, PTR, PTR],
  Equal: [OBJ],
  CopyToClipboard: [],
  Draw: [UINT, PTR, PTR, UINT],
  Activate: [UINT, BOOL, BOOL, UINT, PTR],
  Execute: [UINT, UINT],
  Close: [],
  Update: [],
  Reconnect: [],
  ObjectConvert: [PTR, PTR, DWORD, PTR, PTR],
  GetLinkUpdateOptions: [PTR],
  SetLinkUpdateOptions: [UINT],
  Rename: [PTR],
  QueryName: [PTR, PTR],
  QueryType: [PTR],
  QueryBounds: [PTR],
  QuerySize: [PTR],
  QueryOpen: [],
  QueryOutOfDate: [],
  QueryReleaseStatus: [],
  QueryReleaseError: [],
  QueryReleaseMethod: [],
  RequestData: [UINT],
  ObjectLong: [UINT, PTR],
  ChangeData: [UINT, PTR, BOOL],
};

/** The method each implemented method export is, by its ordinal. */
const METHOD_OF: Record<number, string> = {
  712: 'QueryProtocol',
  701: 'Show',
  702: 'SetData',
  703: 'SetHostNames',
  704: 'SetTargetDevice',
  705: 'SetBounds',
  706: 'CopyFromLink',
  707: 'QueryOpen',
  708: 'Activate',
  709: 'Close',
  710: 'Update',
  711: 'Reconnect',
  713: 'QueryOutOfDate',
  714: 'ObjectConvert',
  715: 'GetLinkUpdateOptions',
  716: 'SetLinkUpdateOptions',
  717: 'Execute',
  718: 'ObjectLong',
  910: 'QueryName',
  911: 'Rename',
  912: 'QueryType',
  913: 'QuerySize',
  1026: 'RequestData',
  1027: 'QueryReleaseStatus',
  1028: 'SetColorScheme',
  1029: 'DoVerb',
  1030: 'QueryType',
  600: 'Release',
  601: 'GetData',
  602: 'SetData',
  603: 'SaveToStream',
  604: 'Clone',
  605: 'Equal',
  606: 'CopyToClipboard',
  608: 'QueryBounds',
  609: 'Draw',
  610: 'EnumFormats',
  611: 'ChangeData',
};

/** An embedded or linked object's methods: the `LE` exports and entries 1000-1005 (**measured** by `oleemb`). */
Object.assign(METHOD_OF, {
  200: 'Release',
  201: 'Show',
  202: 'GetData',
  203: 'SetData',
  204: 'SetHostNames',
  205: 'SetTargetDevice',
  206: 'SetBounds',
  207: 'SaveToStream',
  208: 'Clone',
  209: 'CopyFromLink',
  210: 'Equal',
  211: 'CopyToClipboard',
  212: 'QueryType',
  213: 'QueryBounds',
  214: 'Draw',
  215: 'QueryOpen',
  216: 'Activate',
  218: 'Update',
  219: 'Reconnect',
  220: 'EnumFormats',
  221: 'QueryProtocol',
  222: 'QueryOutOfDate',
  223: 'ObjectConvert',
  224: 'ChangeData',
  225: 'Close',
  226: 'GetLinkUpdateOptions',
  227: 'SetLinkUpdateOptions',
  228: 'Execute',
  229: 'ObjectLong',
  1000: 'RequestData',
  1001: 'QueryReleaseMethod',
  1002: 'QueryReleaseError',
  1003: 'QueryReleaseStatus',
  1004: 'SetColorScheme',
  1005: 'DoVerb',
});

/** Paintbrush's methods, five `PB` exports (**measured** by `olehnd`). */
Object.assign(METHOD_OF, {
  805: 'Draw',
  806: 'QueryBounds',
  807: 'CopyToClipboard',
  810: 'EnumFormats',
  811: 'GetData',
});

/** Each way of making an object's `Dll` arguments, the `Def` and `Pb` exports' (`handlers.ts`). */
const WAY_ARGS: Record<Way, number[]> = {
  load: [PTR, PTR, PTR, DWORD, PTR, PTR, DWORD, UINT, UINT],
  clip: [PTR, PTR, DWORD, PTR, PTR, UINT, UINT, DWORD],
  linkClip: [PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
  template: [PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
  create: [PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
  file: [PTR, PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
  linkFile: [PTR, PTR, PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT],
  invisible: [PTR, PTR, PTR, DWORD, PTR, PTR, UINT, UINT, BOOL],
};

const WAY_NAME: Record<Way, string> = {
  load: 'LoadFromStream',
  clip: 'CreateFromClip',
  linkClip: 'CreateLinkFromClip',
  template: 'CreateFromTemplate',
  create: 'Create',
  file: 'CreateFromFile',
  linkFile: 'CreateLinkFromFile',
  invisible: 'CreateInvisible',
};

/** A `Def` or `Pb` export: its way's arguments, its default or Paintbrush's handler. */
function handlerExport(ordinal: number): [any, string, number[], number] {
  const [way, whose] = HANDLER_EXPORTS[ordinal];
  const name = `${whose === 'def' ? 'Def' : 'Pb'}${WAY_NAME[way]}`;
  const table = whose === 'def' ? DEFAULTS : PAINTBRUSH;
  const implementation = {
    [name](this: any, ...args: number[]) {
      return table[way](
        new Ole(this),
        args.map((arg) => arg >>> 0)
      );
    },
  }[name];

  return [implementation, name, WAY_ARGS[way], UINT];
}

/** `LECREATEINVISIBLE` (230) and the network helpers (950-954), by ordinal. */
const OTHERS: Record<number, [any, string, number[], number]> = {
  230: [
    function LeCreateInvisible(this: any, ...args: number[]) {
      return leCreateInvisible(
        new Ole(this),
        args.map((arg) => arg >>> 0)
      );
    },
    'LeCreateInvisible',
    [PTR, PTR, DWORD, PTR, PTR, UINT, UINT, BOOL],
    UINT,
  ],
  950: [
    function ConnectDlgProc(
      this: any,
      hwnd: number,
      message: number,
      wParam: number,
      lParam: number
    ) {
      return connectDlgProc(new Ole(this), hwnd, message, wParam, lParam);
    },
    'ConnectDlgProc',
    [UINT, UINT, UINT, DWORD],
    BOOL,
  ],
  951: [
    function SetNetName(this: any, object: number) {
      return setNetName(new Ole(this), object);
    },
    'SetNetName',
    [PTR],
    UINT,
  ],
  952: [
    function CheckNetDrive(this: any, object: number, ask: number) {
      return checkNetDrive(new Ole(this), object, ask);
    },
    'CheckNetDrive',
    [PTR, UINT],
    UINT,
  ],
  953: [
    function SetNextNetDrive(this: any, object: number, drive: number, name: number) {
      return setNextNetDrive(new Ole(this), object, drive, name);
    },
    'SetNextNetDrive',
    [PTR, PTR, PTR],
    UINT,
  ],
  954: [
    function GetTaskVisibleWindow(this: any, hwnd: number, out: number) {
      return getTaskVisibleWindow(new Ole(this), hwnd, out);
    },
    'GetTaskVisibleWindow',
    [UINT, DWORD],
    BOOL,
  ],
};

for (const base of [300, 400, 500]) {
  Object.assign(METHOD_OF, {
    [base]: 'Release',
    [base + 1]: 'GetData',
    [base + 2]: 'SaveToStream',
    [base + 3]: 'Clone',
    [base + 4]: 'Equal',
    [base + 5]: 'CopyToClipboard',
    [base + 7]: 'QueryBounds',
    [base + 8]: 'Draw',
    [base + 9]: 'EnumFormats',
    [base + 10]: 'ChangeData',
  });
}

/** A method export: its arguments read as its method's are, and answered by WinBox's method. */
function methodExport(ordinal: number, name: string): [any, number[], number] {
  const method = METHOD_OF[ordinal];
  const answer = method === 'QueryProtocol' ? DWORD : UINT;
  const implementation = {
    [name](this: any, ...args: number[]) {
      return callOwnMethod(new Ole(this), ordinal, args);
    },
  }[name];

  return [implementation, [OBJ, ...METHOD_ARGS[method]], answer];
}

/** `MFCALLBACKFUNC` (102): `EnumMetaFile`'s procedure for a picture being drawn. */
function MFCALLBACKFUNC(
  this: any,
  dc: number,
  table: number,
  record: number,
  objects: number,
  key: number
) {
  return mfCallback(new Ole(this), dc, table, record, objects, key);
}

/** `DOCWNDPROC` (100) and `SRVRWNDPROC` (101): its conversations' windows (`linked.ts`). */
function DOCWNDPROC(this: any, hwnd: number, message: number, wParam: number, lParam: number) {
  return convProc(new Ole(this), hwnd, message, wParam, lParam);
}

function SRVRWNDPROC(this: any, hwnd: number, message: number, wParam: number, lParam: number) {
  return convProc(new Ole(this), hwnd, message, wParam, lParam);
}

/** `WEP`: 1, as a library's is. */
function WEP() {
  return 1;
}

/**
 * An export made to do first what `OLECLI`'s file does as it loads: done as
 * a program first calls it (`start.ts`), in both engines. Its name kept.
 */
function ready(implementation: any, name: string) {
  return {
    async [name](this: any, ...args: any[]) {
      const ole = new Ole(this);

      await start(
        ole,
        (ordinal) => exportAddress(ole, ordinal),
        this._modules.instanceFromPath(PATH) ?? 0
      );
      return implementation.apply(this, args);
    },
  }[name];
}

/**
 * What WinBox's `OLECLI` does not do yet, left to the file's code where the
 * file is on the drive, as it was before WinBox's own: an object made from
 * a template, and a server locked for an object not WinBox's. The object
 * the file makes is used through its own table thereafter, as any object
 * is (`objects.ts`'s `callMethod`), in a document of WinBox's, whose block
 * the file lays out as WinBox does (`olemem`). As `mod.rs`'s `delegated`.
 */
const FILE_FIRST: Record<string, (ole: Ole, args: number[]) => boolean> = {
  OLELOCKSERVER: (ole, args) => isObject(ole, args[0]) && !kindOf(ole, args[0]),
  OLEUNLOCKSERVER: (ole, args) => !ole.state().locks.has(args[0] & 0xffff),
};

/** An export left to the file where it is loaded and its arguments say so (`FILE_FIRST`). */
function fileFirst(implementation: any, fileName: string, ordinal: number, types: number[]) {
  const wanted = FILE_FIRST[fileName];

  if (!wanted) {
    return implementation;
  }

  return {
    async [implementation.name](this: any, ...args: number[]) {
      const ole = new Ole(this);
      const address = fileEntry(this, ordinal);

      if (address && wanted(ole, args)) {
        return ole.callFarTyped(
          address,
          args.map((arg, i) => [arg >>> 0, types[i]])
        );
      }

      return implementation.apply(this, args);
    },
  }[implementation.name];
}

/** The far address of an entry of `OLECLI.DLL`'s, where the file is loaded; nought where it is not. */
function fileEntry(system: any, ordinal: number): number {
  const loader = system._modules.fromName(NAME);

  if (!(loader instanceof Loader)) {
    return 0;
  }

  const info = loader.lookup(ordinal);

  return info && info.segment !== undefined
    ? ((segmentSelector(info.segment) << 16) | info.offset) >>> 0
    : 0;
}

let table: any[] | null = null;

export class OleCli extends Module {
  static get name(): string {
    return NAME;
  }

  static get path() {
    return PATH;
  }

  /**
   * Its table, made once. An entry the file gives no name that WinBox
   * answers -- a method an object's table holds -- is named `Ordinal` and
   * its number; the others with no name `Unknown`, its stub.
   */
  static get exports() {
    if (table) {
      return table;
    }

    const made: any[] = [null];

    for (const [ordinal, fileName, pops] of ENTRIES) {
      const declared = fileName ? API[fileName] : undefined;

      if (declared) {
        made[ordinal] = [
          ready(fileFirst(declared[0], fileName!, ordinal, declared[2]), declared[1]),
          declared[1],
          pops,
          declared[2],
          declared[3],
        ];
      } else if (ordinal === 1) {
        made[ordinal] = [WEP, 'WEP', pops, [INT], INT];
      } else if (ordinal === 100 || ordinal === 101) {
        const name = ordinal === 100 ? 'DOCWNDPROC' : 'SRVRWNDPROC';

        made[ordinal] = [
          ready(ordinal === 100 ? DOCWNDPROC : SRVRWNDPROC, name),
          name,
          pops,
          [UINT, UINT, UINT, DWORD],
          DWORD,
        ];
      } else if (ordinal === 102) {
        made[ordinal] = [
          ready(MFCALLBACKFUNC, 'MFCALLBACKFUNC'),
          'MFCALLBACKFUNC',
          pops,
          [UINT, PTR, PTR, INT, DWORD],
          BOOL,
        ];
      } else if (HANDLER_EXPORTS[ordinal] || OTHERS[ordinal]) {
        const [implementation, name, args, answer] = HANDLER_EXPORTS[ordinal]
          ? handlerExport(ordinal)
          : OTHERS[ordinal];

        made[ordinal] = [ready(implementation, name), name, pops, args, answer];
      } else if (METHOD_OF[ordinal]) {
        const name = fileName ?? `Ordinal${ordinal}`;
        const [implementation, args, answer] = methodExport(ordinal, name);

        made[ordinal] = [ready(implementation, name), name, pops, args, answer];
      } else {
        made[ordinal] = [OleCli.stub, fileName ?? 'Unknown', pops];
      }
    }

    table = made;
    return table;
  }

  static stub() {
    console.log('Stub called!');
  }
}

/** The far address of one of `OLECLI`'s exports: its stub. */
registerAddress((system: any, ordinal: number) => {
  const info = system._modules.load(OleCli).lookup(ordinal);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
});
registerMethods(callOwnMethod);
