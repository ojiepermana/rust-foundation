use axum::Router;
use tokio::net::TcpListener;

// Temporary listen address until the configuration schema (feature 3) replaces it.
const ADDRESS: &str = "127.0.0.1:3000";

#[tokio::main]
async fn main() {
    let listener = TcpListener::bind(ADDRESS)
        .await
        .unwrap_or_else(|error| panic!("cannot bind {ADDRESS}: {error}"));
    println!("api listening on http://{ADDRESS}");
    axum::serve(listener, Router::new())
        .await
        .unwrap_or_else(|error| panic!("server on {ADDRESS} stopped: {error}"));
}
