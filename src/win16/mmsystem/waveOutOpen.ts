/**
 * This function opens a specified waveform output device for playback.
 *
 * The `dwFlags` parameter can be a combination of the following values:
 *
 * | Value               | Meaning                                             |
 * |---------------------|-----------------------------------------------------|
 * | `WAVE_FORMAT_QUERY` | If this flag is specified, the device is to be queried to determine if it supports the given format but is not actually opened. |
 * | `WAVE_ALLOWSYNC`    | Allows a synchronous (blocking) waveform driver to be opened. If this flag is not set while opening a synchronous driver, the open will fail.
 * | `CALLBACK_WINDOW`   | If this flag is specified, `dwCallback` is assumed to be a window handle.
 * | `CALLBACK_FUNCTION` | If this flag is specified, `dwCallback` is assumed to be a callback procedure address.
 * |---------------------|-----------------------------------------------------|
 *
 * Possible return values are as follows:
 *
 * | Value                  | Meaning                                          |
 * |------------------------|--------------------------------------------------|
 * | `MMSYSERR_BADDEVICEID` | Specified device ID is out of range              |
 * | `MMSYSERR_ALLOCATED`   | Specified resource is already allocated.         |
 * | `MMSYSERR_NOMEM`       | Unable to allocate or lock memory.               |
 * | `WAVEERR_BADFORMAT`    | Attempted to open with an unsupported wave format. |
 * | `WAVEERR_SYNC`         | Attempted to open a synchronous driver without specifying the `WAVE_ALLOWSYNC` flag. |
 * |------------------------|--------------------------------------------------|
 *
 * @param {Types.HWAVEOUT} lphWaveOut - Specifies a far pointer to an HWAVEOUT
 *                                      handle. This location is filled with a
 *                                      handle identifying the opened waveform
 *                                      output device. Use the handle to
 *                                      identify the device when calling other
 *                                      waveform output functions. This
 *                                      parameter may be `NULL` if the
 *                                      `WAVE_FORMAT_QUERY` flag is specified
 *                                      for `dwFlags`.
 * @param {Types.UINT} wDeviceID - Identifies the waveform output device to
 *                                 open. Use a valid waveform output device ID
 *                                 or the `WAVE_MAPPER` constant. If this
 *                                 constant is specified, it will select a
 *                                 waveform device capable for playing the
 *                                 given format if no wave mapper is installed.
 * @param {MMSystem.WAVEFORMAT} lpFormat - Specifies a pointer to a `WAVEFORMAT`
 *                                         structure that identifies the format
 *                                         of the waveform data to be sent to
 *                                         the waveform output device.
 * @param {Types.DWORD} dwCallback - Specifies the address of a callback
 *                                   functions or a handle to a window called
 *                                   during waveform playback to process
 *                                   messages related to the progress of the
 *                                   playback. Specify `NULL` for this parameter
 *                                   if no callback is desired.
 * @param {Types.DWORD} dwCallbackInstance - Specifies user instance data passed
 *                                           to the callback. This parameter is
 *                                           not used with window callbacks.
 * @param {Types.DWORD} dwFlags - Specifies flags for opening the device. See
 *                                the description for possible values.
 *
 * @return {UINT} Returns zero if the function was successful. Otherwise, it
 *                returns an error number. Possible error returns are specified
 *                in the description.
 */
export function waveOutOpen(
  lphWaveOut,
  wDeviceID,
  lpFormat,
  dwCallback,
  dwCallbackInstance,
  dwFlags
) {}
