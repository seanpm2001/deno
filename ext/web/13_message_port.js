// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.

// @ts-check
/// <reference path="../../core/lib.deno_core.d.ts" />
/// <reference path="../webidl/internal.d.ts" />
/// <reference path="./internal.d.ts" />
/// <reference path="./lib.deno_web.d.ts" />

const core = globalThis.Deno.core;
const { InterruptedPrototype, ops } = core;
import * as webidl from "ext:deno_webidl/00_webidl.js";
import {
  defineEventHandler,
  EventTarget,
  MessageEvent,
  setEventTargetData,
  setIsTrusted,
} from "ext:deno_web/02_event.js";
import DOMException from "ext:deno_web/01_dom_exception.js";
const primordials = globalThis.__bootstrap.primordials;
const {
  ArrayBufferPrototype,
  ArrayBufferPrototypeGetByteLength,
  ArrayPrototypeFilter,
  ArrayPrototypeIncludes,
  ArrayPrototypePush,
  ObjectPrototypeIsPrototypeOf,
  ObjectSetPrototypeOf,
  Symbol,
  SymbolFor,
  SymbolIterator,
  TypeError,
} = primordials;

class MessageChannel {
  /** @type {MessagePort} */
  #port1;
  /** @type {MessagePort} */
  #port2;

  constructor() {
    this[webidl.brand] = webidl.brand;
    const { 0: port1Id, 1: port2Id } = opCreateEntangledMessagePort();
    const port1 = createMessagePort(port1Id);
    const port2 = createMessagePort(port2Id);
    this.#port1 = port1;
    this.#port2 = port2;
  }

  get port1() {
    webidl.assertBranded(this, MessageChannelPrototype);
    return this.#port1;
  }

  get port2() {
    webidl.assertBranded(this, MessageChannelPrototype);
    return this.#port2;
  }

  [SymbolFor("Deno.inspect")](inspect) {
    return `MessageChannel ${
      inspect({ port1: this.port1, port2: this.port2 })
    }`;
  }
}

webidl.configurePrototype(MessageChannel);
const MessageChannelPrototype = MessageChannel.prototype;

const _id = Symbol("id");
const _enabled = Symbol("enabled");

/**
 * @param {number} id
 * @returns {MessagePort}
 */
function createMessagePort(id) {
  const port = core.createHostObject();
  ObjectSetPrototypeOf(port, MessagePortPrototype);
  port[webidl.brand] = webidl.brand;
  setEventTargetData(port);
  port[_id] = id;
  return port;
}

class MessagePort extends EventTarget {
  /** @type {number | null} */
  [_id] = null;
  /** @type {boolean} */
  [_enabled] = false;

  constructor() {
    super();
    webidl.illegalConstructor();
  }

  /**
   * @param {any} message
   * @param {object[] | StructuredSerializeOptions} transferOrOptions
   */
  postMessage(message, transferOrOptions = {}) {
    webidl.assertBranded(this, MessagePortPrototype);
    const prefix = "Failed to execute 'postMessage' on 'MessagePort'";
    webidl.requiredArguments(arguments.length, 1, prefix);
    message = webidl.converters.any(message);
    let options;
    if (
      webidl.type(transferOrOptions) === "Object" &&
      transferOrOptions !== undefined &&
      transferOrOptions[SymbolIterator] !== undefined
    ) {
      const transfer = webidl.converters["sequence<object>"](
        transferOrOptions,
        prefix,
        "Argument 2",
      );
      options = { transfer };
    } else {
      options = webidl.converters.StructuredSerializeOptions(
        transferOrOptions,
        prefix,
        "Argument 2",
      );
    }
    const { transfer } = options;
    if (ArrayPrototypeIncludes(transfer, this)) {
      throw new DOMException("Can not transfer self", "DataCloneError");
    }
    const data = serializeJsMessageData(message, transfer);
    if (this[_id] === null) return;
    ops.op_message_port_post_message(this[_id], data);
  }

  start() {
    webidl.assertBranded(this, MessagePortPrototype);
    if (this[_enabled]) return;
    (async () => {
      this[_enabled] = true;
      while (true) {
        if (this[_id] === null) break;
        let data;
        try {
          data = await core.opAsync(
            "op_message_port_recv_message",
            this[_id],
          );
        } catch (err) {
          if (ObjectPrototypeIsPrototypeOf(InterruptedPrototype, err)) break;
          throw err;
        }
        if (data === null) break;
        let message, transferables;
        try {
          const v = deserializeJsMessageData(data);
          message = v[0];
          transferables = v[1];
        } catch (err) {
          const event = new MessageEvent("messageerror", { data: err });
          setIsTrusted(event, true);
          this.dispatchEvent(event);
          return;
        }
        const event = new MessageEvent("message", {
          data: message,
          ports: ArrayPrototypeFilter(
            transferables,
            (t) => ObjectPrototypeIsPrototypeOf(MessagePortPrototype, t),
          ),
        });
        setIsTrusted(event, true);
        this.dispatchEvent(event);
      }
      this[_enabled] = false;
    })();
  }

  close() {
    webidl.assertBranded(this, MessagePortPrototype);
    if (this[_id] !== null) {
      core.close(this[_id]);
      this[_id] = null;
    }
  }
}

defineEventHandler(MessagePort.prototype, "message", function (self) {
  self.start();
});
defineEventHandler(MessagePort.prototype, "messageerror");

webidl.configurePrototype(MessagePort);
const MessagePortPrototype = MessagePort.prototype;

/**
 * @returns {[number, number]}
 */
function opCreateEntangledMessagePort() {
  return ops.op_message_port_create_entangled();
}

/**
 * @param {messagePort.MessageData} messageData
 * @returns {[any, object[]]}
 */
function deserializeJsMessageData(messageData) {
  /** @type {object[]} */
  const transferables = [];
  const arrayBufferIdsInTransferables = [];
  const transferredArrayBuffers = [];
  let options;

  if (messageData.transferables.length > 0) {
    const hostObjects = [];
    for (let i = 0; i < messageData.transferables.length; ++i) {
      const transferable = messageData.transferables[i];
      switch (transferable.kind) {
        case "messagePort": {
          const port = createMessagePort(transferable.data);
          ArrayPrototypePush(transferables, port);
          ArrayPrototypePush(hostObjects, port);
          break;
        }
        case "arrayBuffer": {
          ArrayPrototypePush(transferredArrayBuffers, transferable.data);
          const index = ArrayPrototypePush(transferables, null);
          ArrayPrototypePush(arrayBufferIdsInTransferables, index);
          break;
        }
        default:
          throw new TypeError("Unreachable");
      }
    }

    options = {
      hostObjects,
      transferredArrayBuffers,
    };
  }

  const data = core.deserialize(messageData.data, options);

  for (let i = 0; i < arrayBufferIdsInTransferables.length; ++i) {
    const id = arrayBufferIdsInTransferables[i];
    transferables[id] = transferredArrayBuffers[i];
  }

  return [data, transferables];
}

/**
 * @param {any} data
 * @param {object[]} transferables
 * @returns {messagePort.MessageData}
 */
function serializeJsMessageData(data, transferables) {
  let options;
  const transferredArrayBuffers = [];
  if (transferables.length > 0) {
    const hostObjects = [];
    for (let i = 0, j = 0; i < transferables.length; i++) {
      const t = transferables[i];
      if (ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, t)) {
        if (
          ArrayBufferPrototypeGetByteLength(t) === 0 &&
          ops.op_arraybuffer_was_detached(t)
        ) {
          throw new DOMException(
            `ArrayBuffer at index ${j} is already detached`,
            "DataCloneError",
          );
        }
        j++;
        ArrayPrototypePush(transferredArrayBuffers, t);
      } else if (ObjectPrototypeIsPrototypeOf(MessagePortPrototype, t)) {
        ArrayPrototypePush(hostObjects, t);
      }
    }

    options = {
      hostObjects,
      transferredArrayBuffers,
    };
  }

  const serializedData = core.serialize(data, options, (err) => {
    throw new DOMException(err, "DataCloneError");
  });

  /** @type {messagePort.Transferable[]} */
  const serializedTransferables = [];

  let arrayBufferI = 0;
  for (let i = 0; i < transferables.length; ++i) {
    const transferable = transferables[i];
    if (ObjectPrototypeIsPrototypeOf(MessagePortPrototype, transferable)) {
      webidl.assertBranded(transferable, MessagePortPrototype);
      const id = transferable[_id];
      if (id === null) {
        throw new DOMException(
          "Can not transfer disentangled message port",
          "DataCloneError",
        );
      }
      transferable[_id] = null;
      ArrayPrototypePush(serializedTransferables, {
        kind: "messagePort",
        data: id,
      });
    } else if (
      ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, transferable)
    ) {
      ArrayPrototypePush(serializedTransferables, {
        kind: "arrayBuffer",
        data: transferredArrayBuffers[arrayBufferI],
      });
      arrayBufferI++;
    } else {
      throw new DOMException("Value not transferable", "DataCloneError");
    }
  }

  return {
    data: serializedData,
    transferables: serializedTransferables,
  };
}

webidl.converters.StructuredSerializeOptions = webidl
  .createDictionaryConverter(
    "StructuredSerializeOptions",
    [
      {
        key: "transfer",
        converter: webidl.converters["sequence<object>"],
        get defaultValue() {
          return [];
        },
      },
    ],
  );

function structuredClone(value, options) {
  const prefix = "Failed to execute 'structuredClone'";
  webidl.requiredArguments(arguments.length, 1, prefix);
  options = webidl.converters.StructuredSerializeOptions(
    options,
    prefix,
    "Argument 2",
  );
  const messageData = serializeJsMessageData(value, options.transfer);
  return deserializeJsMessageData(messageData)[0];
}

export {
  deserializeJsMessageData,
  MessageChannel,
  MessagePort,
  MessagePortPrototype,
  serializeJsMessageData,
  structuredClone,
};
