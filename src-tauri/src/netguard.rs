// The light clients' network, with the local network left alone.
//
// Peers on Kusama and Asset Hub hand each other every address they listen on, including
// private ones (192.168.x.x, 10.x.x.x, a docker bridge, a .local name). smoldot dials
// whatever it is given, and on a Mac the first dial into the local network makes the
// system ask "allow Birdbrain to find devices on local networks?". Those addresses are
// never reachable from a member's computer anyway, so this wrapper refuses them before
// a socket is opened: the connection fails at once and smoldot moves on to public peers.
//
// Everything else is the default platform, untouched (same shape as smoldot's own
// `WithPrefix` wrapper). Both clients use it: the Birdbrain chain (chain.rs) and Swap's
// relay and Asset Hub (hub.rs).

use std::{
    borrow::Cow,
    future::Future,
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant},
};

use smoldot_light::platform::{
    default::{DefaultPlatform, Stream as DefaultStream},
    with_buffers, Address, ConnectionType, LogLevel, MultiStreamAddress, PlatformRef,
    SubstreamDirection,
};

#[derive(Clone)]
pub struct Guarded(Arc<DefaultPlatform>);

impl Guarded {
    pub fn new(client_name: String, client_version: String) -> Self {
        Guarded(DefaultPlatform::new(client_name, client_version))
    }
}

pub enum Stream {
    Open(Pin<Box<DefaultStream>>),
    Refused(io::Error),
}

fn local_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || (a == 100 && (64..128).contains(&b))
}

fn local_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return local_v4(v4);
    }
    let first = ip.segments()[0];
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
}

fn local_name(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local")
}

/// True when dialling `address` would reach into this computer or its local network.
pub fn is_local(address: &Address) -> bool {
    match address {
        Address::TcpIp { ip, .. } | Address::WebSocketIp { ip, .. } => match ip {
            IpAddr::V4(v4) => local_v4(*v4),
            IpAddr::V6(v6) => local_v6(*v6),
        },
        Address::TcpDns { hostname, .. } | Address::WebSocketDns { hostname, .. } => {
            local_name(hostname)
        }
    }
}

impl PlatformRef for Guarded {
    type Delay = <Arc<DefaultPlatform> as PlatformRef>::Delay;
    type Instant = Instant;
    type MultiStream = <Arc<DefaultPlatform> as PlatformRef>::MultiStream;
    type Stream = Stream;
    type ReadWriteAccess<'a> = with_buffers::ReadWriteAccess<'a, Instant>;
    type StreamErrorRef<'a> = &'a io::Error;
    type StreamConnectFuture = std::future::Ready<Stream>;
    type MultiStreamConnectFuture = <Arc<DefaultPlatform> as PlatformRef>::MultiStreamConnectFuture;
    type StreamUpdateFuture<'a> = Pin<Box<dyn Future<Output = ()> + Send + 'a>>;
    type NextSubstreamFuture<'a> = std::future::Pending<Option<(Stream, SubstreamDirection)>>;

    fn now_from_unix_epoch(&self) -> Duration {
        self.0.now_from_unix_epoch()
    }

    fn now(&self) -> Instant {
        self.0.now()
    }

    fn fill_random_bytes(&self, buffer: &mut [u8]) {
        self.0.fill_random_bytes(buffer)
    }

    fn sleep(&self, duration: Duration) -> Self::Delay {
        self.0.sleep(duration)
    }

    fn sleep_until(&self, when: Instant) -> Self::Delay {
        self.0.sleep_until(when)
    }

    fn spawn_task(&self, task_name: Cow<str>, task: impl Future<Output = ()> + Send + 'static) {
        self.0.spawn_task(task_name, task)
    }

    fn log<'a>(
        &self,
        log_level: LogLevel,
        log_target: &'a str,
        message: &'a str,
        key_values: impl Iterator<Item = (&'a str, &'a dyn std::fmt::Display)>,
    ) {
        self.0.log(log_level, log_target, message, key_values)
    }

    fn client_name(&'_ self) -> Cow<'_, str> {
        self.0.client_name()
    }

    fn client_version(&'_ self) -> Cow<'_, str> {
        self.0.client_version()
    }

    fn supports_connection_type(&self, connection_type: ConnectionType) -> bool {
        self.0.supports_connection_type(connection_type)
    }

    fn connect_stream(&self, address: Address) -> Self::StreamConnectFuture {
        if is_local(&address) {
            return std::future::ready(Stream::Refused(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "local network address, not dialled",
            )));
        }
        // The default platform's future is always ready at once.
        let stream = self.0.connect_stream(address).into_inner();
        std::future::ready(Stream::Open(Box::pin(stream)))
    }

    fn connect_multistream(&self, address: MultiStreamAddress) -> Self::MultiStreamConnectFuture {
        self.0.connect_multistream(address)
    }

    // The default platform never opens multi-stream (WebRTC) connections.
    fn open_out_substream(&self, connection: &mut Self::MultiStream) {
        match *connection {}
    }

    fn next_substream<'a>(
        &self,
        connection: &'a mut Self::MultiStream,
    ) -> Self::NextSubstreamFuture<'a> {
        match *connection {}
    }

    fn read_write_access<'a>(
        &self,
        stream: Pin<&'a mut Stream>,
    ) -> Result<Self::ReadWriteAccess<'a>, &'a io::Error> {
        match stream.get_mut() {
            Stream::Open(s) => self.0.read_write_access(s.as_mut()),
            Stream::Refused(e) => Err(e),
        }
    }

    fn wait_read_write_again<'a>(&self, stream: Pin<&'a mut Stream>) -> Self::StreamUpdateFuture<'a> {
        match stream.get_mut() {
            Stream::Open(s) => self.0.wait_read_write_again(s.as_mut()),
            Stream::Refused(_) => Box::pin(std::future::ready(())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tcp(ip: &str) -> bool {
        is_local(&Address::TcpIp { ip: ip.parse().unwrap(), port: 30333 })
    }

    #[test]
    fn refuses_local_addresses() {
        for ip in [
            "192.168.1.20", "10.0.0.5", "172.17.0.2", "127.0.0.1", "169.254.3.4", "0.0.0.0",
            "100.64.1.1", "224.0.0.251", "::1", "fd00::1", "fe80::1", "::ffff:192.168.0.1",
        ] {
            assert!(tcp(ip), "{ip} should be refused");
        }
        for host in ["localhost", "my-mac.local", "my-mac.local."] {
            assert!(is_local(&Address::TcpDns { hostname: host, port: 1 }), "{host}");
        }
    }

    #[test]
    fn dials_public_addresses() {
        for ip in ["1.1.1.1", "8.8.8.8", "9.9.9.9", "2a01:4f8::1", "172.32.0.1"] {
            assert!(!tcp(ip), "{ip} should be dialled");
        }
        assert!(!is_local(&Address::WebSocketDns {
            hostname: "kusama-bootnode-0.polkadot.io",
            port: 443,
            secure: true,
        }));
    }
}
