#!/usr/bin/env python3
"""
==============================================================================
TenderPocket Automated Client Deployment Wizard
Cross-platform deployment tool for Linux, macOS, Docker, and Remote Servers
==============================================================================
"""

import os
import sys
import subprocess
import shutil

def print_header():
    print("\n" + "=" * 60)
    print("🚀 TENDER POCKET AUTOMATED CLIENT DEPLOYMENT WIZARD")
    print("=" * 60 + "\n")

def run_cmd(cmd, cwd=None, exit_on_fail=True):
    print(f"➜ Executing: {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=cwd)
    if res.returncode != 0 and exit_on_fail:
        print(f"❌ Error executing command. Exit code: {res.returncode}")
        sys.exit(res.returncode)
    return res.returncode

def option_docker_deploy():
    print("\n--- 🐳 Docker 1-Click Stack Deployment (App + PostgreSQL Container) ---")
    print("Building container image and starting PostgreSQL + App services...")
    run_cmd("docker-compose up -d --build")
    print("\n✅ Docker deployment complete!")
    print("📍 Application URL: http://localhost:8080")
    print("📊 View logs: docker-compose logs -f app")

def option_remote_ssh_deploy():
    print("\n--- 🌐 Remote Server SSH Deployment (Linux / Mac Server) ---")
    server_ip = input("Enter Client Server IP / Hostname: ").strip()
    if not server_ip:
        print("❌ IP is required.")
        return
    ssh_user = input("Enter SSH Username [default: root]: ").strip() or "root"
    ssh_port = input("Enter SSH Port [default: 22]: ").strip() or "22"
    db_pass = input("Enter PostgreSQL Password to set [default: postgres_secret_123]: ").strip() or "postgres_secret_123"
    app_port = input("Enter App HTTP Port [default: 8080]: ").strip() or "8080"

    cmd = f"./deploy/deploy-remote.sh -h {server_ip} -u {ssh_user} -p {ssh_port} -P '{db_pass}' -port {app_port}"
    run_cmd(cmd)

def option_prepare_client_package():
    print("\n--- 📦 Prepare Standalone Client Package (Mac & Windows Launchers) ---")
    print("Compiling production JAR with bytecode stripping...")
    run_cmd("mvn clean package -DskipTests")
    
    os.makedirs("client-package", exist_ok=True)
    shutil.copy("target/tender-pocket-spring-0.0.1-SNAPSHOT.jar", "client-package/TenderPocket.jar")
    print("\n✅ Standalone package updated at: client-package/")
    print("   - client-package/Start-TenderPocket.command (Mac Launcher)")
    print("   - client-package/Start-TenderPocket.bat (Windows Launcher)")
    print("   - client-package/TenderPocket.jar (Production Compiled Bytecode)")
    print("   - client-package/application.properties.example (PostgreSQL Config Template)")

def main():
    print_header()
    print("Select deployment target:")
    print("  [1] 🐳 Docker 1-Click Stack (Local / Client Docker Server)")
    print("  [2] 🌐 Remote Linux / Mac Server via SSH (Automated systemd / PostgreSQL)")
    print("  [3] 📦 Prepare Standalone Executable Package (client-package/)")
    print("  [4] ❌ Exit")
    print("")

    choice = input("Enter choice [1-4]: ").strip()
    if choice == "1":
        option_docker_deploy()
    elif choice == "2":
        option_remote_ssh_deploy()
    elif choice == "3":
        option_prepare_client_package()
    elif choice == "4":
        print("Exiting deployment wizard. Bye!")
        sys.exit(0)
    else:
        print("Invalid choice.")
        sys.exit(1)

if __name__ == "__main__":
    main()
