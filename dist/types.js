"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusValue = exports.AudioFormat = exports.MessageType = void 0;
var MessageType;
(function (MessageType) {
    MessageType["AUDIO_OUTPUT"] = "AUDIO_OUTPUT";
    MessageType["STATUS"] = "STATUS";
    MessageType["ERROR"] = "ERROR";
    MessageType["TEXT_INPUT"] = "TEXT_INPUT";
})(MessageType || (exports.MessageType = MessageType = {}));
var AudioFormat;
(function (AudioFormat) {
    AudioFormat["MP3"] = "mp3";
    AudioFormat["PCM"] = "pcm";
    AudioFormat["OPUS"] = "opus";
})(AudioFormat || (exports.AudioFormat = AudioFormat = {}));
var StatusValue;
(function (StatusValue) {
    StatusValue["QUEUED"] = "queued";
    StatusValue["PROCESSING"] = "processing";
    StatusValue["STREAMING"] = "streaming";
    StatusValue["COMPLETED"] = "completed";
    StatusValue["CANCELLED"] = "cancelled";
})(StatusValue || (exports.StatusValue = StatusValue = {}));
//# sourceMappingURL=types.js.map