package com.filehop.transfer

import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketException

object NetUtils {
  private fun activeInterfaces(): List<NetworkInterface> =
    try {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().filter { it.isUp && !it.isLoopback }
    } catch (e: SocketException) {
      emptyList()
    }

  /** Global broadcast plus the directed broadcast of every interface (covers hotspot interfaces). */
  fun broadcastAddresses(): List<InetAddress> {
    val result = linkedSetOf<InetAddress>(InetAddress.getByName("255.255.255.255"))
    activeInterfaces().forEach { ni -> ni.interfaceAddresses.mapNotNullTo(result) { it.broadcast } }
    return result.toList()
  }

  /** IPv4 addresses the user can type on the other phone, Wi-Fi / hotspot interfaces first. */
  fun localIpv4Addresses(): List<String> {
    val preferred = listOf("wlan", "ap", "swlan", "softap")
    return activeInterfaces()
      .sortedBy { ni -> if (preferred.any { ni.name.startsWith(it) }) 0 else 1 }
      .flatMap { ni -> ni.inetAddresses.toList() }
      .filterIsInstance<Inet4Address>()
      .filter { !it.isLoopbackAddress && !it.isLinkLocalAddress }
      .map { it.hostAddress ?: "" }
      .filter { it.isNotEmpty() }
      .distinct()
  }
}
