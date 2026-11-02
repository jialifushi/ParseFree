/**
 * 代理节点协议转换格式化模块
 * 将各协议的代理配置对象转换为标准通用节点分享链接（格式.txt 结构）
 */

import { toBase64 } from "./utils.js";

/**
 * 将单个 Proxy 节点对象转换为标准通用节点链接
 */
export function proxyToUri(p) {
  if (!p || !p.type) return null;
  const type = String(p.type).toLowerCase();
  const name = p.name || `${p.server}:${p.port}`;
  const encodedName = encodeURIComponent(name);

  // 1. VMess 协议 (V2RayN 标准 JSON 格式)
  if (type === "vmess") {
    const vmessObj = {
      v: "2",
      ps: name,
      add: String(p.server || ""),
      port: String(p.port || 443),
      id: String(p.uuid || ""),
      aid: String(p.alterId !== undefined ? p.alterId : 0),
      scy: p.cipher || "auto",
      net: p.network || "tcp",
      type: "none",
      host: p["ws-opts"]?.headers?.Host || p["ws-headers"]?.Host || p.servername || "",
      path: p["ws-opts"]?.path || p["ws-path"] || "",
      tls: p.tls ? "tls" : "",
      sni: p.servername || p["ws-opts"]?.headers?.Host || "",
      alpn: Array.isArray(p.alpn) ? p.alpn.join(",") : (p.alpn || "")
    };
    if (p["skip-cert-verify"]) vmessObj.verify_cert = false;
    return "vmess://" + toBase64(JSON.stringify(vmessObj));
  }

  // 2. Shadowsocks 协议 (SIP002 标准)
  if (type === "ss") {
    const userinfo = toBase64(`${p.cipher}:${p.password}`);
    return `ss://${userinfo}@${p.server}:${p.port}#${encodedName}`;
  }

  // 3. AnyTLS 协议
  if (type === "anytls") {
    const sec = p.tls ? "tls" : "none";
    const sni = p.servername || p.sni || "";
    const alpn = encodeURIComponent(Array.isArray(p.alpn) ? p.alpn[0] : (p.alpn || "http/1.1"));
    const insecure = p["skip-cert-verify"] ? "1" : "0";
    const fp = p["client-fingerprint"] || "chrome";
    return `anytls://${p.password || p.uuid}@${p.server}:${p.port}?security=${sec}&sni=${encodeURIComponent(sni)}&alpn=${alpn}&insecure=${insecure}&fp=${fp}#${encodedName}`;
  }

  // 4. Trojan 协议
  if (type === "trojan") {
    const sni = p.sni || p.servername || p.server;
    return `trojan://${encodeURIComponent(p.password)}@${p.server}:${p.port}?security=tls&sni=${encodeURIComponent(sni)}#${encodedName}`;
  }

  // 5. VLESS 协议
  if (type === "vless") {
    const sec = p.tls ? (p.realityOpts ? "reality" : "tls") : "none";
    const net = p.network || "tcp";
    const sni = p.servername || p.sni || "";
    const path = p["ws-opts"]?.path || "";
    return `vless://${p.uuid}@${p.server}:${p.port}?encryption=none&security=${sec}&type=${net}&sni=${encodeURIComponent(sni)}&path=${encodeURIComponent(path)}#${encodedName}`;
  }

  // 6. Hysteria 2 协议
  if (type === "hysteria2" || type === "hy2") {
    const sni = p.sni || p.servername || "";
    const insecure = p["skip-cert-verify"] ? "1" : "0";
    return `hysteria2://${encodeURIComponent(p.password)}@${p.server}:${p.port}?sni=${encodeURIComponent(sni)}&insecure=${insecure}#${encodedName}`;
  }

  // 7. TUIC 协议
  if (type === "tuic") {
    const sni = p.sni || p.servername || "";
    const alpn = encodeURIComponent(Array.isArray(p.alpn) ? p.alpn.join(",") : (p.alpn || ""));
    return `tuic://${p.uuid}:${encodeURIComponent(p.password)}@${p.server}:${p.port}?sni=${encodeURIComponent(sni)}&alpn=${alpn}#${encodedName}`;
  }

  return null;
}
